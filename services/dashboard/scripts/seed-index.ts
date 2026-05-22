/**
 * Seed an IndexState on the local validator:
 *   1. Register a publisher (admin = publisher = us; min_publishers=1 in Config)
 *   2. Submit a price update for day = today - 1 (within 20:00-23:59 UTC window)
 *   3. Aggregate that day → creates IndexState
 *
 * Prerequisites: init-localnet.ts has been run.
 *
 * Run with:
 *   cd services/dashboard
 *   npx tsx scripts/seed-index.ts
 */

import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import OracleIdl from "../lib/idl/oracle.json";
import type { Oracle } from "../lib/idl/oracle";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const WALLET_PATH =
  process.env.WALLET_PATH ?? path.join(os.homedir(), ".config", "solana", "id.json");

function loadKeypair(p: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(p, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function safeRpc<T>(label: string, fn: () => Promise<T>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("already in use") ||
      msg.includes("custom program error: 0x0") ||
      msg.includes("DuplicateSubmission") ||
      msg.includes("DayAlreadyAggregated")
    ) {
      console.log(`  - ${label} (already done)`);
    } else {
      throw e;
    }
  }
}

async function main(): Promise<void> {
  const admin = loadKeypair(WALLET_PATH);
  const connection = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });
  const oracle = new Program<Oracle>(OracleIdl as unknown as Oracle, provider);

  // Publisher = admin (single-publisher dev setup; min_publishers=1).
  const publisher = admin;
  console.log(`Admin/Publisher: ${admin.publicKey.toBase58()}`);

  // Read existing USDC mint from the admin's ATAs (find the one for our test mint).
  // For dev, we know the mint matches the one created by init-localnet — fetch from token accounts.
  console.log("\nLooking up admin's USDC ATA...");
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
    admin.publicKey,
    { programId: TOKEN_PROGRAM_ID }
  );
  if (tokenAccounts.value.length === 0) {
    throw new Error("No token accounts for admin — run init-localnet.ts first");
  }
  // Use the first non-zero token account
  const usdcAcct = tokenAccounts.value.find(
    (a) => Number(a.account.data.parsed.info.tokenAmount.amount) > 0
  );
  if (!usdcAcct) throw new Error("No funded token account found");
  const usdcMint = new PublicKey(usdcAcct.account.data.parsed.info.mint);
  const adminUsdcAta = usdcAcct.pubkey;
  console.log(`  USDC mint: ${usdcMint.toBase58()}`);
  console.log(`  Admin ATA: ${adminUsdcAta.toBase58()}`);

  // [1] Register publisher
  console.log("\n[1] Register publisher...");
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    oracle.programId
  );
  const [publisherPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("publisher"), publisher.publicKey.toBuffer()],
    oracle.programId
  );
  const [bondVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bond_vault"), publisher.publicKey.toBuffer()],
    oracle.programId
  );

  await safeRpc("register_publisher", () =>
    oracle.methods
      .registerPublisher(publisher.publicKey)
      .accounts({
        config: configPda,
        admin: admin.publicKey,
        publisherAccount: publisherPda,
        adminUsdcAccount: adminUsdcAta,
        bondVault: bondVaultPda,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as never)
      .rpc()
  );

  // [2] Submit price update for the chosen day (defaults to today - 1).
  // Override with `--day N` to re-aggregate on a fresh day after a registry
  // change — useful when the existing IndexState's aggregated_prices are stale
  // against the new base prices.
  const now = Math.floor(Date.now() / 1000);
  const currentDay = Math.floor(now / 86_400);
  const dayArgIdx = process.argv.indexOf("--day");
  const submissionDay =
    dayArgIdx !== -1 && process.argv[dayArgIdx + 1] !== undefined
      ? Number(process.argv[dayArgIdx + 1])
      : currentDay - 1;
  console.log(`\n[2] Submit price update for day ${submissionDay} (current day ${currentDay})...`);

  // 25 prices in micro-USDC. Keep these in sync with init-localnet.ts seed list
  // so post-aggregation %change against base_price reads ~0% across the board.
  const usd = (n: number) => new BN(n * 1_000_000);
  const prices: BN[] = [
    usd(1450), usd(2825), usd( 574), usd( 319), usd( 400),
    usd( 250), usd(3085), usd(1593), usd( 958), usd( 229),
    usd( 394), usd( 399), usd( 494), usd( 592), usd(2761),
    usd( 655), usd(1245), usd(1781), usd( 160), usd( 200),
    usd( 800), usd( 300), usd( 200), usd( 393), usd( 500),
  ];
  // Verified-tier cards get realistic sale counts; rest get a nominal 5.
  const saleCounts: number[] = [
    50, 50, 30, 20, 15,
    10, 50, 50, 30, 20,
    10, 30, 20, 15, 40,
    20, 25, 50, 10,  5,
    15, 10, 10,  5,  5,
  ];

  const sourceRoot = Array.from(Buffer.alloc(32));

  const [priceUpdatePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("price"),
      publisher.publicKey.toBuffer(),
      new BN(submissionDay).toArrayLike(Buffer, "le", 4),
    ],
    oracle.programId
  );

  await safeRpc("submit_price_update", () =>
    oracle.methods
      .submitPriceUpdate(submissionDay, prices, saleCounts, sourceRoot)
      .accounts({
        config: configPda,
        publisher: publisher.publicKey,
        publisherAccount: publisherPda,
        priceUpdate: priceUpdatePda,
        systemProgram: SystemProgram.programId,
      } as never)
      .signers(publisher === admin ? [] : [publisher])
      .rpc()
  );

  // [3] Aggregate day
  console.log(`\n[3] Aggregate day ${submissionDay}...`);
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    oracle.programId
  );
  const [indexStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("index_state")],
    oracle.programId
  );

  await safeRpc("aggregate_day", () =>
    oracle.methods
      .aggregateDay(submissionDay)
      .accounts({
        config: configPda,
        registry: registryPda,
        indexState: indexStatePda,
        caller: admin.publicKey,
        systemProgram: SystemProgram.programId,
      } as never)
      .remainingAccounts([
        { pubkey: priceUpdatePda, isWritable: false, isSigner: false },
      ])
      .rpc()
  );

  // Fetch and display final IndexState
  console.log("\n=== Final IndexState ===");
  const indexState = await oracle.account.indexState.fetch(indexStatePda);
  console.log(`  Day:           ${indexState.day}`);
  console.log(`  Status:        ${Object.keys(indexState.status as object)[0]}`);
  console.log(`  Index value:   ${indexState.indexValue.toString()} (÷1e6 = ${Number(indexState.indexValue) / 1_000_000})`);
  console.log(`  Finalized at:  ${new Date(indexState.finalizedAt.toNumber() * 1000).toISOString()}`);
  console.log("\n  Per-constituent aggregated prices (first 5):");
  for (let i = 0; i < 5; i++) {
    const p = (indexState.aggregatedPrices as BN[])[i].toString();
    const s = (indexState.constituentStatus as number[])[i];
    console.log(`    slot ${i}: ${p} micro-USDC, status ${s === 0 ? "ok" : s === 1 ? "stale" : "ejected"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
