/**
 * Call aggregate_day on mainnet with NO PriceUpdate accounts.
 *
 * Used immediately post-PMT50-migration to rewrite IndexState in the new
 * N=50 layout. With empty remaining_accounts and min_publishers_per_day=1,
 * every constituent falls into the "stale" branch:
 *   - aggregated_prices[i] = 0
 *   - constituent_status[i] = 1 (stale)
 *   - index calc uses 1.0 contribution per slot ⇒ index_value = $1000.000
 *
 * The point isn't the value — it's that the IndexState struct gets fully
 * rewritten at the new field offsets, so dashboard + perp-engine (which
 * have the new layout compiled in) both read the same coherent values.
 *
 * Real prices land at the next publisher submission cycle (Railway crank
 * after UTC midnight rollover).
 *
 * Run:
 *   cd services/dashboard
 *   RPC_URL="<mainnet>" CALLER_KEYPAIR=/d/pokeperp/mainnet-keys/deploy.json \
 *   DAY=20602 npx tsx scripts/aggregate-empty-mainnet.ts
 */
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "node:fs";

import OracleIdl from "../lib/idl/oracle.json";

const RPC = process.env.RPC_URL!;
const CALLER_KP = process.env.CALLER_KEYPAIR!;
const DAY = Number(process.env.DAY ?? "0");
const ORACLE = new PublicKey("GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i");

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

async function main(): Promise<void> {
  if (!RPC) throw new Error("RPC_URL required");
  if (!CALLER_KP) throw new Error("CALLER_KEYPAIR required");
  if (!DAY) throw new Error("DAY required");
  if (!RPC.includes("mainnet")) throw new Error(`Refusing: RPC not mainnet (${RPC})`);

  const caller = loadKeypair(CALLER_KP);
  const conn = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(caller), { commitment: "confirmed" });
  const oracle = new Program(OracleIdl as any, provider);

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], ORACLE);
  const [registryPda] = PublicKey.findProgramAddressSync([Buffer.from("registry")], ORACLE);
  const [indexStatePda] = PublicKey.findProgramAddressSync([Buffer.from("index_state")], ORACLE);

  console.log(`aggregate_day(${DAY}) with empty remaining_accounts...`);
  console.log(`caller: ${caller.publicKey.toBase58()}`);

  const sig = await oracle.methods
    .aggregateDay(DAY)
    .accounts({
      config: configPda,
      registry: registryPda,
      indexState: indexStatePda,
      caller: caller.publicKey,
      systemProgram: SystemProgram.programId,
    } as never)
    .remainingAccounts([])
    .rpc();
  console.log("    tx:", sig);

  const idx: any = await oracle.account.indexState.fetch(indexStatePda);
  console.log("\n=== Post-aggregate IndexState ===");
  console.log(`  day:          ${idx.day}`);
  console.log(`  status:       ${Object.keys(idx.status as object)[0]}`);
  console.log(`  index_value:  ${idx.indexValue.toString()} (= $${Number(idx.indexValue) / 1_000_000})`);
  console.log(`  finalized_at: ${new Date(idx.finalizedAt.toNumber() * 1000).toISOString()}`);
  let ok = 0, stale = 0;
  for (let i = 0; i < 50; i++) {
    if (idx.constituentStatus[i] === 0) ok++;
    else if (idx.constituentStatus[i] === 1) stale++;
  }
  console.log(`  slot states:  ok=${ok}/50  stale=${stale}/50`);
}

main().catch((e) => { console.error(e); process.exit(1); });
