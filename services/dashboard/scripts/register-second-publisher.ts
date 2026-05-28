/**
 * Register a SECOND publisher on the oracle program (devnet).
 *
 * Why we need this: the PriceUpdate PDA is per-(publisher, day).  When seed-
 * index.ts ran earlier it created the (admin, day=20599) entry, so the admin
 * publisher is "used up" for day 20599 and can't submit fresh prices until
 * UTC day rollover.  Registering a SECOND publisher gives us a fresh PDA
 * slot so we can submit a new price update for day 20599 right now — and
 * once we re-aggregate with BOTH submissions in remaining_accounts, the
 * on-chain median moves from the seeded numbers to the median of (seed,
 * scraper-derived) prices.
 *
 * What this script does:
 *   1. Generate a fresh keypair, write to services/publisher/devnet-keys/publisher-2.json
 *   2. Transfer 0.5 SOL from admin → new publisher (for future tx fees)
 *   3. admin calls register_publisher(new_publisher_pubkey)
 *      → escrows 10k USDC from admin's ATA into the new publisher's bond vault
 *      → creates the Publisher PDA (status=Shadow, eligible to submit per oracle.md §2)
 *
 * Output: prints the new keypair path so subsequent work (running the Rust
 * publisher binary in real mode) can point at it.
 *
 * Run with:
 *   cd services/dashboard
 *   RPC_URL=https://api.devnet.solana.com npx tsx scripts/register-second-publisher.ts
 */

import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import OracleIdl from "../lib/idl/oracle.json";
import type { Oracle } from "../lib/idl/oracle";

import { resolveRpc } from "./rpc";
const RPC = resolveRpc();
const ADMIN_WALLET =
  process.env.WALLET_PATH ?? path.join(os.homedir(), ".config", "solana", "id.json");

// Which publisher slot to bootstrap.  Override via env PUBLISHER_INDEX so the
// same script registers pub-2, pub-3, pub-4… without duplication.
const PUBLISHER_INDEX = process.env.PUBLISHER_INDEX ?? "2";
const PUBLISHER_KEY_DIR = path.join(
  __dirname,
  "..",
  "..",
  "publisher",
  "devnet-keys",
);
const PUBLISHER_KEY_PATH = path.join(
  PUBLISHER_KEY_DIR,
  `publisher-${PUBLISHER_INDEX}.json`,
);

function loadKeypair(p: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(p, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function loadOrCreateKeypair(p: string): { kp: Keypair; created: boolean } {
  if (fs.existsSync(p)) {
    return { kp: loadKeypair(p), created: false };
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const kp = Keypair.generate();
  fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)));
  return { kp, created: true };
}

async function main(): Promise<void> {
  const admin = loadKeypair(ADMIN_WALLET);
  const { kp: publisher, created } = loadOrCreateKeypair(PUBLISHER_KEY_PATH);

  console.log(`RPC:               ${RPC}`);
  console.log(`Admin:             ${admin.publicKey.toBase58()}`);
  console.log(
    `Publisher-2:       ${publisher.publicKey.toBase58()}  ${created ? "(NEW)" : "(reused)"}`,
  );
  console.log(`Keypair file:      ${PUBLISHER_KEY_PATH}`);

  const connection = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });
  const oracle = new Program<Oracle>(OracleIdl as unknown as Oracle, provider);

  // ----- Step 1: ensure publisher-2 has SOL for tx fees -----
  const balance = await connection.getBalance(publisher.publicKey);
  console.log(`\n[1] Publisher-2 SOL balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  const targetSol = 0.5 * LAMPORTS_PER_SOL;
  if (balance < targetSol) {
    const topup = targetSol - balance;
    console.log(`    Transferring ${topup / LAMPORTS_PER_SOL} SOL from admin...`);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: publisher.publicKey,
        lamports: topup,
      }),
    );
    const sig = await provider.sendAndConfirm(tx, []);
    console.log(`    ✓ sig: ${sig}`);
  } else {
    console.log("    ✓ already funded");
  }

  // ----- Step 2: find admin's USDC ATA (source of the publisher bond) -----
  console.log("\n[2] Locating admin's USDC ATA for bond payment...");
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
    admin.publicKey,
    { programId: TOKEN_PROGRAM_ID },
  );
  const usdcAcct = tokenAccounts.value.find(
    (a) => Number(a.account.data.parsed.info.tokenAmount.amount) > 0,
  );
  if (!usdcAcct) {
    throw new Error("Admin has no funded USDC account — can't pay bond");
  }
  const usdcMint = new PublicKey(usdcAcct.account.data.parsed.info.mint);
  const adminUsdcAta = usdcAcct.pubkey;
  const adminUsdcAmount = Number(usdcAcct.account.data.parsed.info.tokenAmount.amount);
  console.log(`    USDC mint:      ${usdcMint.toBase58()}`);
  console.log(`    Admin USDC ATA: ${adminUsdcAta.toBase58()}`);
  console.log(`    Admin balance:  ${(adminUsdcAmount / 1e6).toLocaleString()} USDC`);
  if (adminUsdcAmount < 10_000_000_000) {
    throw new Error(
      `Admin USDC balance (${adminUsdcAmount / 1e6}) is below the 10k publisher bond. ` +
        `Mint more before registering.`,
    );
  }

  // ----- Step 3: register publisher-2 -----
  console.log("\n[3] Calling register_publisher...");
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    oracle.programId,
  );
  const [publisherPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("publisher"), publisher.publicKey.toBuffer()],
    oracle.programId,
  );
  const [bondVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bond_vault"), publisher.publicKey.toBuffer()],
    oracle.programId,
  );

  // Check if already registered (idempotent re-run).
  const existing = await oracle.account.publisher.fetchNullable(publisherPda);
  if (existing) {
    console.log(`    - already registered`);
    console.log(`      status:        ${Object.keys(existing.status as object)[0]}`);
    console.log(`      bond_amount:   ${existing.bondAmount.toString()} micro-USDC`);
    console.log(`      joined_day:    ${existing.joinedDay}`);
  } else {
    const sig = await oracle.methods
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
      .rpc();
    console.log(`    ✓ registered, sig: ${sig}`);
    const fresh = await oracle.account.publisher.fetch(publisherPda);
    console.log(`      status:        ${Object.keys(fresh.status as object)[0]}`);
    console.log(`      bond_amount:   ${fresh.bondAmount.toString()} micro-USDC`);
    console.log(`      joined_day:    ${fresh.joinedDay}`);
    console.log(`      shadow_days:   ${fresh.shadowPeriodDaysRemaining} (Shadow status can still submit)`);
  }

  console.log(`\n=== Bootstrap done ===`);
  console.log(`Publisher PDA:  ${publisherPda.toBase58()}`);
  console.log(`Bond vault:     ${bondVaultPda.toBase58()}`);
  console.log(`\nNext step: run the Rust publisher binary pointed at`);
  console.log(`  ${PUBLISHER_KEY_PATH}`);
  console.log(`Set wallet_path in services/publisher/examples/publisher.devnet.toml`);
  console.log(`then: cd services/publisher && cargo run --release -- --config examples/publisher.devnet.toml run`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
