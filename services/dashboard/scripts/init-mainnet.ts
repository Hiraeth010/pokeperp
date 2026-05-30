/**
 * One-time MAINNET initialization.
 *
 * Differs from init-localnet.ts:
 *   - Uses REAL circle USDC (EPjFWdd5...) — does NOT create a mint or airdrop.
 *   - Production Config params (single-operator oracle: minPublishersPerDay=1,
 *     nominal 100 USDC publisher bond — self-bond is economically moot for a
 *     single operator; revisit before adding a publisher federation / scaling TVL).
 *   - Initializes the market then IMMEDIATELY set_pause(true): trading stays
 *     disabled until the insurance fund is seeded and we explicitly unpause.
 *
 * Moves NO USDC (Config/registry/market/insurance-vault/treasury-vault init only),
 * so it runs before the insurance-seed funds exist. Publisher registration
 * (escrows the 100 USDC bond) and the insurance deposit are separate, later steps.
 *
 * Run with (from services/dashboard):
 *   RPC_URL="<mainnet helius>" WALLET_PATH="D:\\pokeperp\\mainnet-keys\\deploy.json" \
 *     npx tsx scripts/init-mainnet.ts
 */

import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import OracleIdl from "../lib/idl/oracle.json";
import PerpIdl from "../lib/idl/perp_engine.json";
import type { Oracle } from "../lib/idl/oracle";
import type { PerpEngine } from "../lib/idl/perp_engine";

import { resolveRpc } from "./rpc";

const RPC = resolveRpc();
const WALLET_PATH =
  process.env.WALLET_PATH ?? path.join(os.homedir(), ".config", "solana", "id.json");

// Circle USDC on Solana mainnet-beta.
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

function loadKeypair(p: string): Keypair {
  const secret = JSON.parse(fs.readFileSync(p, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function fixedBytes(s: string, len: number): number[] {
  const buf = Buffer.alloc(len);
  Buffer.from(s).copy(buf, 0, 0, Math.min(s.length, len));
  return Array.from(buf);
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
      msg.includes("InstructionError(0, Custom(0))")
    ) {
      console.log(`  - ${label} (already exists)`);
    } else {
      console.log(`  ✗ ${label}`);
      throw e;
    }
  }
}

async function main(): Promise<void> {
  if (!RPC.includes("mainnet")) {
    throw new Error(`Refusing to run: RPC does not look like mainnet (${RPC}). Set RPC_URL.`);
  }
  const wallet = loadKeypair(WALLET_PATH);
  const connection = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(wallet), {
    commitment: "confirmed",
  });
  const oracle = new Program<Oracle>(OracleIdl as unknown as Oracle, provider);
  const perp = new Program<PerpEngine>(PerpIdl as unknown as PerpEngine, provider);

  console.log("Admin wallet:  ", wallet.publicKey.toBase58());
  console.log("Oracle program:", oracle.programId.toBase58());
  console.log("Perp program:  ", perp.programId.toBase58());
  console.log("USDC mint:     ", USDC_MINT.toBase58());
  console.log("Balance:       ", (await connection.getBalance(wallet.publicKey)) / 1e9, "SOL\n");

  // 1. Oracle Config (production, single-operator).
  console.log("[1] Oracle Config...");
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    oracle.programId
  );
  await safeRpc("initialize Config", () =>
    oracle.methods
      .initialize({
        publisherBond: new BN(100_000_000), // 100 USDC nominal (single-operator)
        challengeBond: new BN(10_000_000), // 10 USDC
        minPublishersPerDay: 1,
        // Single-operator: full-day window so the crank can submit promptly after
        // the UTC rollover (a tight 20:00-23:59 window only matters for coordinating
        // an independent publisher federation, which we don't have at launch).
        submissionWindowStart: 0,
        submissionWindowEnd: 24 * 3600 - 1,
        challengeWindowSeconds: 3600,
      })
      .accounts({
        admin: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      } as never)
      .rpc()
  );

  // 2. Constituent Registry.
  console.log("\n[2] Constituent Registry (zero-copy init)...");
  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    oracle.programId
  );
  await safeRpc("initialize_registry", () =>
    oracle.methods
      .initializeRegistry()
      .accounts({
        admin: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      } as never)
      .rpc()
  );

  // 3. Seed PMT constituents (inception list; base_price is the stale-decay
  // fallback — live prices come from the publisher crank).
  //
  // NOTE (v0.10): this script only seeds the original 25 inception entries
  // and is preserved as the historical fresh-deploy path.  Existing mainnet
  // deployment is upgraded in-place via `expand-to-50.ts` (admin one-shot
  // realloc + 25× `update_constituent` for PMT26-50 + `finalize_registry_update`),
  // which preserves the populated PMT1-25 slots.  Re-running init-mainnet
  // against the live program would fail at `initialize_registry` (account
  // already exists).
  console.log("\n[3] Seeding 25 PMT inception constituents...");
  const seeds: Array<{
    name: string;
    set: string;
    num: number;
    variant: string;
    total: number;
    price: number;
  }> = [
    { name: "Umbreon VMAX",          set: "ES",  num: 215, variant: "AA",  total: 203, price: 1450 },
    { name: "Rayquaza VMAX",         set: "ES",  num: 218, variant: "AA",  total: 203, price: 2825 },
    { name: "Espeon V",              set: "ES",  num: 180, variant: "AA",  total: 203, price:  574 },
    { name: "Leafeon V",             set: "ES",  num: 167, variant: "AA",  total: 203, price:  319 },
    { name: "Sylveon V",             set: "ES",  num: 184, variant: "AA",  total: 203, price:  400 },
    { name: "Glaceon V",             set: "ES",  num: 175, variant: "AA",  total: 203, price:  250 },
    { name: "Giratina V",            set: "LO",  num: 186, variant: "AA",  total: 196, price: 3085 },
    { name: "Lugia V",               set: "ST",  num: 186, variant: "AA",  total: 195, price: 1593 },
    { name: "Charizard V",           set: "BS",  num: 154, variant: "AA",  total: 172, price:  958 },
    { name: "Charizard VSTAR",       set: "BS",  num: 174, variant: "RR",  total: 172, price:  229 },
    { name: "Charizard VMAX",        set: "CP",  num:  74, variant: "RR",  total:  73, price:  394 },
    { name: "Pikachu VMAX",          set: "VV",  num: 188, variant: "RR",  total: 185, price:  399 },
    { name: "Mew V",                 set: "FS",  num: 251, variant: "AA",  total: 264, price:  494 },
    { name: "Mew VMAX",              set: "FS",  num: 269, variant: "AA",  total: 264, price:  592 },
    { name: "Gengar VMAX",           set: "FS",  num: 271, variant: "AA",  total: 264, price: 2761 },
    { name: "Reshiram & Charizard",  set: "UB",  num: 217, variant: "RR",  total: 214, price:  655 },
    { name: "Mewtwo & Mew",          set: "UM",  num: 242, variant: "RR",  total: 236, price: 1245 },
    { name: "Charizard ex 151",      set: "PMK", num: 199, variant: "SIR", total: 165, price: 1781 },
    { name: "Giovanni's Charisma",   set: "PMK", num: 204, variant: "SIR", total: 165, price:  160 },
    { name: "Hisuian Zoroark VSTAR", set: "CZ",  num:  56, variant: "GG",  total:  70, price:  200 },
    { name: "Charizard ex OF",       set: "OF",  num: 215, variant: "SIR", total: 197, price:  800 },
    { name: "Gardevoir ex",          set: "PaF", num: 233, variant: "SIR", total:  91, price:  300 },
    { name: "Iono SAR",              set: "PE",  num: 269, variant: "SAR", total: 193, price:  200 },
    { name: "Charizard TG",          set: "LO",  num:   3, variant: "TG",  total:  30, price:  393 },
    { name: "Charizard VMAX SV",     set: "SF",  num: 107, variant: "RR",  total: 122, price:  500 },
  ];
  for (let idx = 0; idx < seeds.length; idx++) {
    const s = seeds[idx];
    await safeRpc(`slot ${idx} = ${s.name} (${s.set} #${s.num} ${s.variant}) @ $${s.price}`, () =>
      oracle.methods
        .updateConstituent(idx, {
          basePrice: new BN(s.price * 1_000_000),
          canonicalSearchHash: Array.from(Buffer.alloc(32)),
          setCode: fixedBytes(s.set, 8),
          variantCode: fixedBytes(s.variant, 8),
          collectorNumber: s.num,
          setTotal: s.total,
        })
        .accounts({ admin: wallet.publicKey } as never)
        .rpc()
    );
  }

  // 4. Finalize registry v1.
  console.log("\n[4] Finalize registry v1...");
  const today = Math.floor(Date.now() / 86_400_000);
  await safeRpc(`finalize_registry_update day=${today}`, () =>
    oracle.methods
      .finalizeRegistryUpdate(today)
      .accounts({ admin: wallet.publicKey } as never)
      .rpc()
  );

  // 5. Insurance Fund (empty — seeded later via deposit_insurance).
  console.log("\n[5] Insurance Fund + Vault (empty)...");
  await safeRpc("initialize_insurance_fund", () =>
    perp.methods
      .initializeInsuranceFund()
      .accounts({
        usdcMint: USDC_MINT,
        admin: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as never)
      .rpc()
  );

  // 6. Treasury (receives 90% of taker fees per spec §9).
  console.log("\n[6] Treasury + Vault...");
  await safeRpc("initialize_treasury", () =>
    perp.methods
      .initializeTreasury()
      .accounts({
        usdcMint: USDC_MINT,
        admin: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as never)
      .rpc()
  );

  // 7. Wire perp treasury vault into oracle Config (needed before any challenge).
  console.log("\n[7] set_protocol_treasury on oracle...");
  const [treasuryVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury_vault")],
    perp.programId
  );
  await safeRpc("set_protocol_treasury", () =>
    oracle.methods
      .setProtocolTreasury(treasuryVaultPda)
      .accounts({ config: configPda, admin: wallet.publicKey } as never)
      .rpc()
  );

  // 8. Market (Phase-1 params).
  console.log("\n[8] Market (phase 1 params)...");
  const [indexStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("index_state")],
    oracle.programId
  );
  const [insuranceVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_vault")],
    perp.programId
  );
  await safeRpc("initialize_market", () =>
    perp.methods
      .initializeMarket({
        oracleIndexState: indexStatePda,
        usdcMint: USDC_MINT,
        insuranceVault: insuranceVaultPda,
        slippageFactor: 100_000,
        oiFloor: new BN(100_000_000_000),
        initialMarginBps: 3300,
        maintenanceMarginBps: 1650,
        fundingCapPerHourBps: 10,
        takerFeeBps: 10,
        liquidationPenaltyBps: 150,
        maxOiPerSide: new BN(500_000_000_000),
        maxPositionPerTrader: new BN(50_000_000_000),
        maxPositionsPerSide: 25,
        adlHaircutBps: 5000,
      })
      .accounts({
        usdcMint: USDC_MINT,
        admin: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      } as never)
      .rpc()
  );

  // 9. PAUSE trading immediately. initialize_market defaults trading_paused=false,
  // which would open trading against an empty insurance fund. Keep it closed until
  // insurance is seeded and we explicitly unpause (set_pause false / set_phase 1).
  console.log("\n[9] set_pause(trading=true) — trading stays closed until insurance is seeded...");
  await safeRpc("set_pause(true)", () =>
    perp.methods
      .setPause(true, false, 1)
      .accounts({ admin: wallet.publicKey } as never)
      .rpc()
  );

  console.log("\n✓ Mainnet skeleton initialized (market PAUSED).");
  console.log("");
  console.log("Addresses:");
  console.log(`  ORACLE_PROGRAM   ${oracle.programId.toBase58()}`);
  console.log(`  PERP_PROGRAM     ${perp.programId.toBase58()}`);
  console.log(`  CONFIG_PDA       ${configPda.toBase58()}`);
  console.log(`  REGISTRY_PDA     ${registryPda.toBase58()}`);
  console.log(`  INDEX_STATE_PDA  ${indexStatePda.toBase58()}`);
  console.log(`  TREASURY_VAULT   ${treasuryVaultPda.toBase58()}`);
  console.log(`  INSURANCE_VAULT  ${insuranceVaultPda.toBase58()}`);
  console.log(`  USDC_MINT        ${USDC_MINT.toBase58()}`);
  console.log("");
  console.log("Remaining: register publisher (100 USDC bond) → point crank at mainnet →");
  console.log("seed insurance (10k USDC) → create Squad + migrate admin → cutover dashboard →");
  console.log("set_pause(false) to enable trading.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
