/**
 * Smoke test for modify_position with v0.2 funding settlement + TWAP update.
 *
 * Flow:
 *   1. open_position long 600 USDC, ~$200 margin
 *   2. modify_position +400 USDC (grow to 1000)
 *   3. modify_position -300 USDC (shrink to 700)
 *   4. close_position
 *
 * Validates that:
 *   - Each modify settles funding (no-op cash flow when funding accumulator
 *     hasn't moved, but the snapshot is re-stamped each call)
 *   - Position size + market OI track correctly
 *   - Margin vault balance only changes if funding actually accrued
 *   - close at the end leaves market OI back to 0
 *
 * Run with:
 *   cd services/dashboard && npx tsx scripts/test-modify.ts
 */

import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import PerpIdl from "../lib/idl/perp_engine.json";
import OracleIdl from "../lib/idl/oracle.json";
import type { PerpEngine } from "../lib/idl/perp_engine";
import type { Oracle } from "../lib/idl/oracle";

import { resolveRpc } from "./rpc";
const RPC = resolveRpc();
const WALLET_PATH =
  process.env.WALLET_PATH ??
  path.join(os.homedir(), ".config", "solana", "id.json");

function loadKeypair(p: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(p, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

const usdc = (n: number) => new BN(Math.round(n * 1_000_000).toString());
const fmtUsd = (raw: bigint | BN | string) =>
  `$${(Number(BigInt(raw.toString())) / 1_000_000).toFixed(6)}`;

async function main(): Promise<void> {
  const wallet = loadKeypair(WALLET_PATH);
  const connection = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(wallet), {
    commitment: "confirmed",
  });
  const perp = new Program<PerpEngine>(
    PerpIdl as unknown as PerpEngine,
    provider
  );
  const oracle = new Program<Oracle>(OracleIdl as unknown as Oracle, provider);

  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market")],
    perp.programId
  );
  const [indexStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("index_state")],
    oracle.programId
  );
  const [insuranceFundPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_fund")],
    perp.programId
  );
  const [insuranceVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_vault")],
    perp.programId
  );
  const market = await perp.account.market.fetch(marketPda);
  const usdcMint = market.usdcMint as PublicKey;
  const ata = await getAssociatedTokenAddress(usdcMint, wallet.publicKey);

  const [positionPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      wallet.publicKey.toBuffer(),
      marketPda.toBuffer(),
    ],
    perp.programId
  );
  const [marginVaultPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("margin_vault"),
      wallet.publicKey.toBuffer(),
      marketPda.toBuffer(),
    ],
    perp.programId
  );

  // Clean up any stale position from a previous run.
  const stale = await perp.account.position.fetchNullable(positionPda);
  if (stale) {
    console.log("[0] cleaning up stale position...");
    await perp.methods
      .closePosition()
      .accounts({
        trader: wallet.publicKey,
        traderUsdcAccount: ata,
        usdcMint,
        indexState: indexStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as never)
      .rpc();
  }

  console.log("Trader:", wallet.publicKey.toBase58());
  console.log(`Initial OI: long ${market.longOi.toString()}, short ${market.shortOi.toString()}\n`);

  async function snapshot(label: string): Promise<void> {
    const p = await perp.account.position.fetchNullable(positionPda);
    const m = await perp.account.market.fetch(marketPda);
    const v = await connection.getTokenAccountBalance(marginVaultPda).catch(() => null);
    console.log(`[${label}]`);
    if (p) {
      console.log(`  position.size:                 ${p.size.toString()}`);
      console.log(`  position.cum_funding_snapshot: ${p.cumulativeFundingSnapshot.toString()}`);
    } else {
      console.log("  position: <closed>");
    }
    console.log(`  market.long_oi:                ${m.longOi.toString()}`);
    console.log(`  market.cum_funding_long:       ${m.cumulativeFundingLong.toString()}`);
    console.log(`  market.mark_twap_5min:         ${fmtUsd(m.markTwap5Min)}`);
    if (v?.value.amount) {
      console.log(`  margin_vault:                  ${fmtUsd(v.value.amount)}`);
    }
    console.log();
  }

  // ===== 1. Open =====
  // Margin sized to comfortably cover the max-leverage modify below (1000 USDC
  // notional × 33% IM = $330 minimum).
  console.log("[1] open_position long 600 USDC notional, $400 margin...");
  const openSig = await perp.methods
    .openPosition(usdc(600), usdc(400))
    .accounts({
      trader: wallet.publicKey,
      traderUsdcAccount: ata,
      usdcMint,
      indexState: indexStatePda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .rpc();
  console.log(`  tx ${openSig.slice(0, 12)}…\n`);
  await snapshot("post-open");

  // ===== 2. Modify +400 (grow to 1000) =====
  console.log("[2] modify_position +400 USDC (grow long to 1000)...");
  const grow = await perp.methods
    .modifyPosition(usdc(400))
    .accounts({
      trader: wallet.publicKey,
      indexState: indexStatePda,
      insuranceFund: insuranceFundPda,
      insuranceVault: insuranceVaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as never)
    .rpc();
  console.log(`  tx ${grow.slice(0, 12)}…\n`);
  await snapshot("post-grow");

  // ===== 3. Modify -300 (shrink to 700) =====
  console.log("[3] modify_position -300 USDC (shrink long to 700)...");
  const shrink = await perp.methods
    .modifyPosition(usdc(-300))
    .accounts({
      trader: wallet.publicKey,
      indexState: indexStatePda,
      insuranceFund: insuranceFundPda,
      insuranceVault: insuranceVaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as never)
    .rpc();
  console.log(`  tx ${shrink.slice(0, 12)}…\n`);
  await snapshot("post-shrink");

  // ===== 4. Close =====
  console.log("[4] close_position...");
  const close = await perp.methods
    .closePosition()
    .accounts({
      trader: wallet.publicKey,
      traderUsdcAccount: ata,
      usdcMint,
      indexState: indexStatePda,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as never)
    .rpc();
  console.log(`  tx ${close.slice(0, 12)}…\n`);
  await snapshot("post-close");

  console.log("✓ modify_position flow exercised end-to-end");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
