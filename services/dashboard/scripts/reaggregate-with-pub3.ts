/**
 * Re-aggregate day 20599 on devnet using ONLY publisher-3's PriceUpdate.
 *
 * Why pub-3 only: pub-2 has stale fallback for slots 1+4 (Rayquaza, Sylveon)
 * because Oxylabs returned 613 on those queries during its run.  Pub-3 has
 * fresh real data for those slots but stale for slot 7 (Lugia V — same 613
 * issue, different slot).  Mixing the two via aggregate_day's median doesn't
 * help because any single stale fallback pollutes the median for its slot.
 *
 * Pub-3 has the best overall coverage (24/25 fresh), so we aggregate with
 * just pub-3 and slot 7 falls back to its verified inception price ($1593).
 * Future runs will be cleaner once the scraper service retries 613s.
 *
 * Run:
 *   cd services/dashboard
 *   RPC_URL=https://api.devnet.solana.com npx tsx scripts/reaggregate-with-pub3.ts
 */

import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import OracleIdl from "../lib/idl/oracle.json";
import type { Oracle } from "../lib/idl/oracle";

import { resolveRpc } from "./rpc";
const RPC = resolveRpc();
const ADMIN_WALLET =
  process.env.WALLET_PATH ??
  path.join(os.homedir(), ".config", "solana", "id.json");

const PUBLISHER_3_PUBKEY = new PublicKey(
  "G3LnXi6YWXXoAQr8CFm8gnvyjZJ6fpnmX66RK6sKzCrS",
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
  const [pub3PriceUpdate] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("price"),
      PUBLISHER_3_PUBKEY.toBuffer(),
      new BN(TARGET_DAY).toArrayLike(Buffer, "le", 4),
    ],
    oracle.programId,
  );

  // Snapshot BEFORE.
  const before = await oracle.account.indexState.fetch(indexStatePda);
  console.log("IndexState BEFORE:");
  console.log(`  index_value: $${(Number(before.indexValue) / 1e6).toFixed(2)}`);

  // Re-aggregate with ONLY pub-3.
  console.log("\nCalling aggregate_day with pub-3 only...");
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
      { pubkey: pub3PriceUpdate, isWritable: false, isSigner: false },
    ])
    .rpc();
  console.log(`  ✓ tx: ${sig}`);

  // Snapshot AFTER.
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
  console.log("\nPer-constituent prices (BEFORE → AFTER):");
  for (let i = 0; i < 25; i++) {
    const b = Number((before.aggregatedPrices as BN[])[i]) / 1e6;
    const a = Number((after.aggregatedPrices as BN[])[i]) / 1e6;
    const delta = a - b;
    const arrow =
      Math.abs(delta) < 0.01 ? "  =" : delta > 0 ? "↑" : "↓";
    const sign = delta >= 0 ? "+" : "";
    const tag = i === 1 || i === 4 ? "  ← was STALE" : i === 7 ? "  ← now STALE" : "";
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
