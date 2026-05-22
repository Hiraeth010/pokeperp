/**
 * Exercises the full perp trade lifecycle against the local validator:
 *   1. open_position (long, 500 USDC notional, 3x leverage = 167 USDC margin)
 *   2. add_margin (+50 USDC)
 *   3. withdraw_margin (-20 USDC)
 *   4. close_position
 *
 * Validates the same Anchor methods the dashboard's useTradeActions uses.
 * Run with:
 *   cd services/dashboard && npx tsx scripts/test-trade.ts
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

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const WALLET_PATH =
  process.env.WALLET_PATH ??
  path.join(os.homedir(), ".config", "solana", "id.json");

function loadKeypair(p: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(p, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

const usdc = (n: number) => new BN(Math.round(n * 1_000_000).toString());

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

  console.log("Trader:", wallet.publicKey.toBase58());

  // Look up market + USDC mint
  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market")],
    perp.programId
  );
  const [indexStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("index_state")],
    oracle.programId
  );
  const market = await perp.account.market.fetch(marketPda);
  const usdcMint = market.usdcMint as PublicKey;
  const ata = await getAssociatedTokenAddress(usdcMint, wallet.publicKey);

  console.log(`USDC mint:   ${usdcMint.toBase58()}`);
  console.log(`Trader ATA:  ${ata.toBase58()}`);
  console.log(
    `Initial OI:  long ${market.longOi.toString()}, short ${market.shortOi.toString()}\n`
  );

  // ===== 0. Clean up any stale position from a previous failed run =====
  const [positionPdaProbe] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      wallet.publicKey.toBuffer(),
      marketPda.toBuffer(),
    ],
    perp.programId
  );
  const stale = await perp.account.position.fetchNullable(positionPdaProbe);
  if (stale) {
    console.log("[0] Stale position from previous run — closing first...");
    const sig = await perp.methods
      .closePosition()
      .accounts({
        trader: wallet.publicKey,
        traderUsdcAccount: ata,
        usdcMint,
        indexState: indexStatePda,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as never)
      .rpc();
    console.log(`  cleaned up tx ${sig.slice(0, 12)}…\n`);
  }

  // ===== 1. Open long position =====
  console.log("[1] open_position long 500 USDC notional, 3x leverage...");
  const size = usdc(500); // 500 USDC notional, positive = long
  const margin = usdc(500 / 3); // ~$166.67 margin

  const openSig = await perp.methods
    .openPosition(size, margin)
    .accounts({
      trader: wallet.publicKey,
      traderUsdcAccount: ata,
      usdcMint,
      indexState: indexStatePda,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as never)
    .rpc();
  console.log(`  tx ${openSig.slice(0, 12)}…`);

  // Inspect post-open state
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
  let position = await perp.account.position.fetch(positionPda);
  let vaultBal = (
    await connection.getTokenAccountBalance(marginVaultPda)
  ).value.uiAmount;
  let mkt = await perp.account.market.fetch(marketPda);
  console.log(`  Position size:   ${position.size.toString()} (+ = long)`);
  console.log(`  Entry mark:      $${Number(position.entryMarkPrice) / 1e6}`);
  console.log(`  Margin vault:    $${vaultBal}`);
  console.log(`  Market long OI:  ${Number(mkt.longOi) / 1e6} USDC\n`);

  // ===== 2. Add margin =====
  console.log("[2] add_margin +$50...");
  const addSig = await perp.methods
    .addMargin(usdc(50))
    .accounts({
      trader: wallet.publicKey,
      traderUsdcAccount: ata,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as never)
    .rpc();
  console.log(`  tx ${addSig.slice(0, 12)}…`);
  vaultBal = (await connection.getTokenAccountBalance(marginVaultPda)).value
    .uiAmount;
  console.log(`  Margin vault:    $${vaultBal}\n`);

  // ===== 3. Withdraw margin =====
  console.log("[3] withdraw_margin -$20...");
  const wdSig = await perp.methods
    .withdrawMargin(usdc(20))
    .accounts({
      trader: wallet.publicKey,
      traderUsdcAccount: ata,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as never)
    .rpc();
  console.log(`  tx ${wdSig.slice(0, 12)}…`);
  vaultBal = (await connection.getTokenAccountBalance(marginVaultPda)).value
    .uiAmount;
  console.log(`  Margin vault:    $${vaultBal}\n`);

  // Pause so a slow indexer (5s position-poll cadence) gets a chance to record
  // the position as open before we close it — necessary for the realized-PnL
  // capture path to fire. Set `FAST_CLOSE=1` to skip.
  if (!process.env.FAST_CLOSE) {
    console.log("  (pausing 7s for indexer to register open)");
    await new Promise((r) => setTimeout(r, 7000));
  }

  // ===== 4. Close position =====
  console.log("[4] close_position...");
  const closeSig = await perp.methods
    .closePosition()
    .accounts({
      trader: wallet.publicKey,
      traderUsdcAccount: ata,
      usdcMint,
      indexState: indexStatePda,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as never)
    .rpc();
  console.log(`  tx ${closeSig.slice(0, 12)}…`);

  // Verify everything is cleaned up
  const positionAfter = await perp.account.position.fetchNullable(positionPda);
  const vaultInfoAfter = await connection.getAccountInfo(marginVaultPda);
  mkt = await perp.account.market.fetch(marketPda);
  console.log(
    `  Position account: ${positionAfter === null ? "closed ✓" : "STILL EXISTS"}`
  );
  console.log(
    `  Margin vault:     ${vaultInfoAfter === null ? "closed ✓" : "STILL EXISTS"}`
  );
  console.log(
    `  Market long OI:   ${Number(mkt.longOi) / 1e6} USDC (should be back to 0)\n`
  );

  console.log("✓ Full trade lifecycle exercised successfully");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
