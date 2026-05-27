/**
 * Re-aggregate day 20599 on devnet with BOTH publishers' PriceUpdates.
 *
 * After seed-index.ts (admin's seeded prices) + the Rust publisher binary
 * run (publisher-2's scraper-derived prices), there are now two PriceUpdate
 * PDAs for day 20599.  The first aggregate_day call only consumed the admin's
 * submission.  This script calls aggregate_day again with both PDAs in
 * remaining_accounts so the on-chain median moves to reflect both.
 *
 * After this runs, pokeperp.com should show updated per-constituent prices
 * (median of seed and scraper for each slot) + an updated index_value.
 *
 * Run:
 *   cd services/dashboard
 *   RPC_URL=https://api.devnet.solana.com npx tsx scripts/reaggregate-with-both-publishers.ts
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

const ADMIN_PUBKEY = new PublicKey(
  "4HFrD7pzn72rqmGwadV7AouYLiFSfuLtgL4LWMVXQpG9",
);
const PUBLISHER_2_PUBKEY = new PublicKey(
  "4RatLVR4oLXmPAp1McgHawmx79dHxRak6ef5ij1o3K3E",
);
const TARGET_DAY = 20599;

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))),
  );
}

function priceUpdatePda(
  publisher: PublicKey,
  day: number,
  programId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("price"),
      publisher.toBuffer(),
      new BN(day).toArrayLike(Buffer, "le", 4),
    ],
    programId,
  )[0];
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
  const adminPriceUpdate = priceUpdatePda(
    ADMIN_PUBKEY,
    TARGET_DAY,
    oracle.programId,
  );
  const publisher2PriceUpdate = priceUpdatePda(
    PUBLISHER_2_PUBKEY,
    TARGET_DAY,
    oracle.programId,
  );

  console.log(`RPC:               ${RPC}`);
  console.log(`Target day:        ${TARGET_DAY}`);
  console.log(`Admin PriceUpdate: ${adminPriceUpdate.toBase58()}`);
  console.log(`Pub-2 PriceUpdate: ${publisher2PriceUpdate.toBase58()}`);

  // Sanity check both PriceUpdates exist.
  console.log("\nVerifying both PriceUpdates exist on chain...");
  for (const [label, pda] of [
    ["admin", adminPriceUpdate],
    ["pub-2", publisher2PriceUpdate],
  ] as const) {
    const acc = await oracle.account.priceUpdate.fetchNullable(pda);
    if (!acc) throw new Error(`${label} PriceUpdate not found at ${pda.toBase58()}`);
    console.log(
      `  ✓ ${label}: day=${acc.day} prices[0]=${(Number(acc.prices[0]) / 1e6).toFixed(2)}  prices[17]=${(Number(acc.prices[17]) / 1e6).toFixed(2)}`,
    );
  }

  // Snapshot BEFORE.
  console.log("\nIndexState BEFORE:");
  const before = await oracle.account.indexState.fetch(indexStatePda);
  console.log(`  day:         ${before.day}`);
  console.log(`  status:      ${Object.keys(before.status as object)[0]}`);
  console.log(`  index_value: $${(Number(before.indexValue) / 1e6).toFixed(2)}`);
  console.log(`  slot 0 (Umbreon):       $${(Number((before.aggregatedPrices as BN[])[0]) / 1e6).toFixed(2)}`);
  console.log(`  slot 17 (Charizard 151): $${(Number((before.aggregatedPrices as BN[])[17]) / 1e6).toFixed(2)}`);

  // Re-aggregate with both PriceUpdates.
  console.log("\nCalling aggregate_day with both PriceUpdates...");
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
      { pubkey: adminPriceUpdate, isWritable: false, isSigner: false },
      { pubkey: publisher2PriceUpdate, isWritable: false, isSigner: false },
    ])
    .rpc();
  console.log(`  ✓ tx: ${sig}`);

  // Snapshot AFTER.
  console.log("\nIndexState AFTER:");
  const after = await oracle.account.indexState.fetch(indexStatePda);
  console.log(`  day:         ${after.day}`);
  console.log(`  status:      ${Object.keys(after.status as object)[0]}`);
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
    const sign = delta > 0 ? "+" : "";
    const arrow = Math.abs(delta) < 0.01 ? "  =" : delta > 0 ? "↑" : "↓";
    console.log(
      `  slot ${String(i).padStart(2)}  $${b.toFixed(2).padStart(8)} → $${a.toFixed(2).padStart(8)}  ${arrow} ${sign}${delta.toFixed(2).padStart(8)}  ${names[i]}`,
    );
  }

  const indexDelta = Number(after.indexValue) - Number(before.indexValue);
  const pctChange = (indexDelta / Number(before.indexValue)) * 100;
  console.log(`\nIndex value Δ: $${(indexDelta / 1e6).toFixed(2)} (${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(2)}%)`);
  console.log("\nDashboard should now show the new values. Hard-refresh pokeperp.com");
  console.log("(Ctrl+Shift+R) to bypass the live useIndexState() cache, or just wait for");
  console.log("the next WebSocket account-change push to land.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
