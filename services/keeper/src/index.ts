/**
 * Pokeperp keeper — funding + liquidation crank.
 *
 * Two jobs, both run every tick of a poll loop:
 *
 *   1. settle_funding: advance the global funding accumulator. The on-chain ix
 *      no-ops if < 1h has elapsed since the last accrual, so it's safe to call
 *      every tick — funding actually moves at most once per hour.
 *
 *   2. liquidation scan: enumerate all open Position accounts, recompute each
 *      one's equity the same way the on-chain `liquidate` ix does
 *      (equity = margin + price_pnl - funding_owed, with a liquidatee-favoring
 *      reference price), and call `liquidate` on any position whose equity has
 *      fallen below its maintenance-margin requirement. The off-chain check is
 *      just a filter — the program re-checks authoritatively and reverts a
 *      healthy position, so a false positive only costs a (caught) failed tx.
 *
 * Both instructions are permissionless; the keeper keypair is the fee payer and
 * (for liquidations) receives the 1/3 liquidator penalty into its USDC ATA.
 *
 * Deploy: Railway worker (NIXPACKS). Key injected via KEEPER_KEYPAIR_JSON.
 */

import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import * as fs from "node:fs";

import PerpIdl from "../idl/perp_engine.json" with { type: "json" };
import type { PerpEngine } from "../idl/perp_engine.ts";

const RPC_HTTP = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_MS ?? "60000");
const PERP_ID = new PublicKey(
  process.env.PERP_PROGRAM_ID ?? "Gtpv6K9Fi3pkYcYZEzqaS8DW2nqDwpwPf24Q1WxsQzsa"
);

const pda = (seed: string) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed)], PERP_ID)[0];
const MARKET_PDA = pda("market");
const INSURANCE_FUND_PDA = pda("insurance_fund");
const INSURANCE_VAULT_PDA = pda("insurance_vault");

/** Load the keeper keypair: KEEPER_KEYPAIR_JSON env (Railway secret) first, else
 *  the file at KEEPER_KEYPAIR_PATH for local dev. */
function loadKeeper(): Keypair {
  const json = process.env.KEEPER_KEYPAIR_JSON?.trim();
  if (json) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json)));
  const p = process.env.KEEPER_KEYPAIR_PATH;
  if (!p) throw new Error("set KEEPER_KEYPAIR_JSON or KEEPER_KEYPAIR_PATH");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

const big = (x: { toString(): string }) => BigInt(x.toString());

/** Replicate the on-chain liquidate equity check. Returns true if the position
 *  is under its maintenance-margin requirement at the liquidatee-favoring price. */
function isLiquidatable(
  pos: { size: BN; entryMarkPrice: BN; cumulativeFundingSnapshot: BN },
  marginAmount: bigint,
  markTwap5Min: bigint,
  indexPrice: bigint,
  cumulativeFundingLong: bigint,
  maintenanceMarginBps: number
): { liq: boolean; equity: bigint; mm: bigint } {
  const size = big(pos.size);
  const entryMark = big(pos.entryMarkPrice);
  if (entryMark === 0n) return { liq: false, equity: 0n, mm: 0n };
  const isLong = size > 0n;

  // liq_ref_price favors the liquidatee (matches lib.rs liquidate()).
  let liqRef: bigint;
  if (isLong) {
    liqRef = markTwap5Min > 0n && markTwap5Min < indexPrice ? markTwap5Min : indexPrice;
  } else {
    liqRef = markTwap5Min > 0n && markTwap5Min > indexPrice ? markTwap5Min : indexPrice;
  }

  const pricePnl = (size * (liqRef - entryMark)) / entryMark;
  const fundingOwed = (size * (cumulativeFundingLong - big(pos.cumulativeFundingSnapshot))) / 1_000_000n;
  const pnl = pricePnl - fundingOwed;
  const equity = marginAmount + pnl;
  const absSize = size < 0n ? -size : size;
  const mm = (absSize * BigInt(maintenanceMarginBps)) / 10_000n;
  return { liq: equity < mm, equity, mm };
}

async function main(): Promise<void> {
  const keeper = loadKeeper();
  const connection = new Connection(RPC_HTTP, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(keeper), {
    commitment: "confirmed",
  });
  const perp = new Program<PerpEngine>(PerpIdl as unknown as PerpEngine, provider);

  console.log("pokeperp keeper");
  console.log(`  rpc:       ${RPC_HTTP}`);
  console.log(`  keeper:    ${keeper.publicKey.toBase58()}`);
  console.log(`  interval:  ${INTERVAL_MS}ms`);

  const market = await perp.account.market.fetch(MARKET_PDA);
  const usdcMint = market.usdcMint as PublicKey;
  const indexStatePda = market.oracleIndexState as PublicKey;

  // Ensure the keeper's USDC ATA exists — liquidate() pays the 1/3 penalty into
  // it and the account must already exist (it isn't init'd by the ix).
  const keeperAta = await getOrCreateAssociatedTokenAccount(
    connection,
    keeper,
    usdcMint,
    keeper.publicKey
  );
  console.log(`  usdc ata:  ${keeperAta.address.toBase58()}`);
  console.log(`  index:     ${indexStatePda.toBase58()}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function settleFunding(mkt: any): Promise<void> {
    // settle_funding no-ops on-chain until 1h has elapsed; gate here so we don't
    // burn a tx every tick. The accumulator advances at most once per hour.
    const now = Math.floor(Date.now() / 1000);
    const elapsed = now - Number(mkt.lastFundingUpdate);
    if (elapsed < 3600) {
      console.log(`[funding] ${Math.floor(elapsed / 60)}m since last accrual (<60m) — skipping`);
      return;
    }
    try {
      const sig = await perp.methods
        .settleFunding()
        .accounts({ market: MARKET_PDA, caller: keeper.publicKey, indexState: indexStatePda })
        .rpc();
      console.log(`[funding] accrued ~${Math.floor(elapsed / 3600)}h ${sig.slice(0, 12)}…`);
    } catch (e) {
      console.error(`[funding] settle_funding failed: ${(e as Error).message.slice(0, 160)}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function scanLiquidations(mkt: any, idx: any): Promise<void> {
    const indexPrice = big(idx.indexValue);
    if (indexPrice === 0n) {
      console.log("[liq] index price 0 — skipping");
      return;
    }
    const markTwap5Min = big(mkt.markTwap5Min);
    const cumFundingLong = big(mkt.cumulativeFundingLong);
    const mmBps = Number(mkt.maintenanceMarginBps);

    const positions = await perp.account.position.all();
    let candidates = 0;
    for (const { account: pos, publicKey: positionPda } of positions) {
      let marginAmount: bigint;
      try {
        const bal = await connection.getTokenAccountBalance(pos.marginVault as PublicKey);
        marginAmount = BigInt(bal.value.amount);
      } catch {
        continue; // vault gone (position mid-close) — skip
      }
      const { liq, equity, mm } = isLiquidatable(
        pos as never,
        marginAmount,
        markTwap5Min,
        indexPrice,
        cumFundingLong,
        mmBps
      );
      if (!liq) continue;
      candidates++;
      const trader = pos.trader as PublicKey;
      console.log(
        `[liq] liquidatable ${trader.toBase58().slice(0, 8)}… equity=${equity} < mm=${mm} — liquidating`
      );
      try {
        const sig = await perp.methods
          .liquidate()
          .accounts({
            market: MARKET_PDA,
            liquidator: keeper.publicKey,
            trader,
            position: positionPda,
            marginVault: pos.marginVault as PublicKey,
            traderUsdcAccount: getAssociatedTokenAddressSync(usdcMint, trader),
            liquidatorUsdcAccount: keeperAta.address,
            insuranceVault: INSURANCE_VAULT_PDA,
            insuranceFund: INSURANCE_FUND_PDA,
            usdcMint,
            indexState: indexStatePda,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        console.log(`[liq] liquidated ${trader.toBase58().slice(0, 8)}… ${sig.slice(0, 12)}…`);
      } catch (e) {
        console.error(`[liq] liquidate ${trader.toBase58().slice(0, 8)}… failed: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    console.log(`[liq] scanned ${positions.length} position(s), ${candidates} liquidatable`);
  }

  async function tick(): Promise<void> {
    let mkt, idx;
    try {
      [mkt, idx] = await Promise.all([
        perp.account.market.fetch(MARKET_PDA),
        perp.account.indexState.fetch(indexStatePda),
      ]);
    } catch (e) {
      console.error(`[tick] state fetch failed: ${(e as Error).message.slice(0, 120)}`);
      return;
    }
    await settleFunding(mkt);
    await scanLiquidations(mkt, idx);
  }

  await tick();
  setInterval(() => {
    tick().catch((e) => console.error("tick failed:", (e as Error).message));
  }, INTERVAL_MS);
}

main().catch((e) => {
  console.error("keeper fatal:", e);
  process.exit(1);
});
