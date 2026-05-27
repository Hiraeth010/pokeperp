/**
 * Re-aggregate day 20599 on devnet using ONLY publisher-4's PriceUpdate.
 *
 * Pub-4 is the first run that uses the curated search queries (full Pokemon
 * name + set name + variant words, instead of "Pokemon ES 218/203 Alt Art
 * PSA 10").  Quality of fresh data is dramatically better — e.g. Giratina V
 * went from $281 (noise from bad query) to $3,122 (real PSA 10 sales).
 *
 * Tradeoff: 6 slots still hit transient Oxylabs 613s during the run and
 * fell back to verified inception prices.  Those will reduce on future
 * publisher runs once the scraper service's retry-on-613 logic finishes
 * Railway deployment.
 *
 * Run:
 *   cd services/dashboard
 *   RPC_URL=https://api.devnet.solana.com npx tsx scripts/reaggregate-with-pub4.ts
 */

import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import OracleIdl from "../lib/idl/oracle.json";
import type { Oracle } from "../lib/idl/oracle";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const ADMIN_WALLET =
  process.env.WALLET_PATH ??
  path.join(os.homedir(), ".config", "solana", "id.json");

const PUBLISHER_4_PUBKEY = new PublicKey(
  "HLqpyCARa14gG2QsXPNNfQNZVNwzPTZqKZjPag1RStid",
);
const TARGET_DAY = 20599;

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))),
  );
}

async function main(): Promise<void> {
  const admin = loadKeypair(ADMIN_WALLET);
  const connection = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });
  const oracle = new Program<Oracle>(OracleIdl as unknown as Oracle, provider);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    oracle.programId,
  );
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    oracle.programId,
  );
  const [indexStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("index_state")],
    oracle.programId,
  );
  const [pub4PriceUpdate] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("price"),
      PUBLISHER_4_PUBKEY.toBuffer(),
      new BN(TARGET_DAY).toArrayLike(Buffer, "le", 4),
    ],
    oracle.programId,
  );

  const before = await oracle.account.indexState.fetch(indexStatePda);
  console.log("IndexState BEFORE:");
  console.log(`  index_value: $${(Number(before.indexValue) / 1e6).toFixed(2)}`);

  console.log("\nCalling aggregate_day with pub-4 only (curated queries)...");
  const sig = await oracle.methods
    .aggregateDay(TARGET_DAY)
    .accounts({
      config: configPda,
      registry: registryPda,
      indexState: indexStatePda,
      caller: admin.publicKey,
      systemProgram: SystemProgram.programId,
    } as never)
    .remainingAccounts([
      { pubkey: pub4PriceUpdate, isWritable: false, isSigner: false },
    ])
    .rpc();
  console.log(`  ✓ tx: ${sig}`);

  const after = await oracle.account.indexState.fetch(indexStatePda);
  console.log("\nIndexState AFTER:");
  console.log(`  index_value: $${(Number(after.indexValue) / 1e6).toFixed(2)}`);

  const names = [
    "Umbreon VMAX","Rayquaza VMAX","Espeon V","Leafeon V","Sylveon V",
    "Glaceon V","Giratina V","Lugia V","Charizard V","Charizard VSTAR",
    "Charizard CP","Pikachu VMAX","Mew V","Mew VMAX","Gengar VMAX",
    "Resh&Char","Mew2&Mew","Charizard 151","Giovanni","Zoroark VSTAR",
    "Charizard OF","Gardevoir","Iono","Charizard TG","Charizard SV",
  ];
  // Slots where pub-4 hit a 613 transient + fell back to inception prices.
  const STALE_SLOTS = new Set([0, 15, 16, 19, 21, 24]);
  console.log("\nPer-constituent prices (BEFORE → AFTER):");
  for (let i = 0; i < 25; i++) {
    const b = Number((before.aggregatedPrices as BN[])[i]) / 1e6;
    const a = Number((after.aggregatedPrices as BN[])[i]) / 1e6;
    const delta = a - b;
    const arrow =
      Math.abs(delta) < 0.01 ? "  =" : delta > 0 ? "↑" : "↓";
    const sign = delta >= 0 ? "+" : "";
    const tag = STALE_SLOTS.has(i) ? "  ← STALE (Oxylabs 613)" : "";
    console.log(
      `  slot ${String(i).padStart(2)}  $${b.toFixed(2).padStart(8)} → $${a.toFixed(2).padStart(8)}  ${arrow} ${sign}${delta.toFixed(2).padStart(8)}  ${names[i]}${tag}`,
    );
  }

  const idxDelta = Number(after.indexValue) - Number(before.indexValue);
  const pct = (idxDelta / Number(before.indexValue)) * 100;
  console.log(
    `\nIndex value Δ: $${(idxDelta / 1e6).toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
