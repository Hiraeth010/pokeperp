/**
 * One-shot mainnet post-PMT50-migration helper.
 *
 * After expand_constituents_to_50 + finalize_registry_update, the on-chain
 * IndexState struct field offsets shift (because [u64; 25] → [u64; 50] etc.)
 * — the realloc preserves the leading bytes but the dashboard now reads
 * index_value from a different byte offset, which is zero-padded after
 * realloc. Cosmetically the site shows $0.00 until the next aggregate_day
 * call overwrites the whole struct.
 *
 * This script:
 *   1. Submits a PriceUpdate for today using base_prices from the registry
 *      (so I = 1000.000 exactly — equivalent to a "no drift" reading).
 *      The Railway publisher takes over from tomorrow with real scrape data.
 *   2. Calls aggregate_day(today) so IndexState is rewritten with proper
 *      N=50 layout, index_value, finalized_at, etc.
 *
 * Idempotent: if today's price update or aggregation already exists, the
 * RPC will revert and we surface the error.
 *
 * Run:
 *   cd services/dashboard
 *   RPC_URL="<mainnet>" \
 *   PUBLISHER_KEYPAIR=/d/pokeperp/mainnet-keys/publisher.json \
 *   npx tsx scripts/aggregate-mainnet-postmigration.ts
 */
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "node:fs";

import OracleIdl from "../lib/idl/oracle.json";

const RPC = process.env.RPC_URL!;
const PUB_KP_PATH = process.env.PUBLISHER_KEYPAIR!;
const ORACLE = new PublicKey("GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i");

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

async function main(): Promise<void> {
  if (!RPC) throw new Error("RPC_URL required");
  if (!PUB_KP_PATH) throw new Error("PUBLISHER_KEYPAIR path required");
  if (!RPC.includes("mainnet")) throw new Error(`Refusing: RPC not mainnet (${RPC})`);

  const publisher = loadKeypair(PUB_KP_PATH);
  const conn = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(publisher), { commitment: "confirmed" });
  const oracle = new Program(OracleIdl as any, provider);

  console.log("publisher:", publisher.publicKey.toBase58());

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], ORACLE);
  const [publisherPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("publisher"), publisher.publicKey.toBuffer()],
    ORACLE,
  );
  const [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], ORACLE);
  const [indexStatePda] = PublicKey.findProgramAddressSync([Buffer.from("index_state")], ORACLE);

  // Pull base prices from the registry so the submission produces index_value = 1000.
  const reg: any = await oracle.account.constituentRegistry.fetch(registryPda);
  const prices: BN[] = reg.constituents.map((c: any) => new BN(c.basePrice.toString()));
  const saleCounts: number[] = new Array(50).fill(10);
  const sourceRoot = Array.from(Buffer.alloc(32));
  if (prices.length !== 50) throw new Error(`registry has ${prices.length} constituents (expected 50)`);

  const today = Math.floor(Date.now() / 86_400_000);
  console.log(`day = ${today}`);
  console.log(`prices.length = ${prices.length} (slot 0 = $${prices[0].toNumber() / 1e6})`);

  const [priceUpdatePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("price"),
      publisher.publicKey.toBuffer(),
      new BN(today).toArrayLike(Buffer, "le", 4),
    ],
    ORACLE,
  );

  console.log("\n[1] submit_price_update...");
  const submitSig = await oracle.methods
    .submitPriceUpdate(today, prices, saleCounts, sourceRoot)
    .accounts({
      config: configPda,
      publisher: publisher.publicKey,
      publisherAccount: publisherPda,
      priceUpdate: priceUpdatePda,
      systemProgram: SystemProgram.programId,
    } as never)
    .rpc();
  console.log("    tx:", submitSig);

  console.log(`\n[2] aggregate_day(${today})...`);
  const aggSig = await oracle.methods
    .aggregateDay(today)
    .accounts({
      config: configPda,
      registry: registryPda,
      indexState: indexStatePda,
      caller: publisher.publicKey,
      systemProgram: SystemProgram.programId,
    } as never)
    .remainingAccounts([{ pubkey: priceUpdatePda, isWritable: false, isSigner: false }])
    .rpc();
  console.log("    tx:", aggSig);

  console.log("\n=== Final IndexState ===");
  const idx: any = await oracle.account.indexState.fetch(indexStatePda);
  console.log(`  day:          ${idx.day}`);
  console.log(`  status:       ${Object.keys(idx.status as object)[0]}`);
  console.log(`  index_value:  ${idx.indexValue.toString()} (÷1e6 = ${Number(idx.indexValue) / 1_000_000})`);
  console.log(`  finalized_at: ${new Date(idx.finalizedAt.toNumber() * 1000).toISOString()}`);
  let ok = 0;
  for (let i = 0; i < 50; i++) if (idx.constituentStatus[i] === 0) ok++;
  console.log(`  ok slots:     ${ok}/50`);
}

main().catch((e) => { console.error(e); process.exit(1); });
