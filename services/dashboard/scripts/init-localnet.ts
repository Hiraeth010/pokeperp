/**
 * One-time initialization for the local validator.
 * Creates a fake USDC mint, initializes oracle Config + ConstituentRegistry,
 * seeds 3 demo constituents, finalizes registry v1, initializes perp
 * InsuranceFund + Market.
 *
 * Run with:
 *   cd services/dashboard
 *   npx tsx scripts/init-localnet.ts
 */

import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import OracleIdl from "../lib/idl/oracle.json";
import PerpIdl from "../lib/idl/perp_engine.json";
import type { Oracle } from "../lib/idl/oracle";
import type { PerpEngine } from "../lib/idl/perp_engine";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const WALLET_PATH =
  process.env.WALLET_PATH ?? path.join(os.homedir(), ".config", "solana", "id.json");

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
  const wallet = loadKeypair(WALLET_PATH);
  console.log("Admin wallet:", wallet.publicKey.toBase58());
  const connection = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(wallet), {
    commitment: "confirmed",
  });
  const oracle = new Program<Oracle>(OracleIdl as unknown as Oracle, provider);
  const perp = new Program<PerpEngine>(
    PerpIdl as unknown as PerpEngine,
    provider
  );

  console.log(`RPC: ${RPC}`);
  console.log(`Oracle program: ${oracle.programId.toBase58()}`);
  console.log(`Perp program:   ${perp.programId.toBase58()}`);
  console.log(
    `Balance: ${(await connection.getBalance(wallet.publicKey)) / 1e9} SOL\n`
  );

  // 1. Fake USDC mint
  console.log("[1] Creating fake USDC mint...");
  const usdcMint = await createMint(
    connection,
    wallet,
    wallet.publicKey,
    null,
    6
  );
  console.log(`  USDC mint: ${usdcMint.toBase58()}`);

  // 2. Wallet USDC ATA + 100k USDC for testing
  console.log("\n[2] Creating ATA + minting 100k USDC to wallet...");
  const ata = await createAssociatedTokenAccount(
    connection,
    wallet,
    usdcMint,
    wallet.publicKey
  );
  await mintTo(connection, wallet, usdcMint, ata, wallet, 100_000_000_000n);
  console.log(`  ATA: ${ata.toBase58()}`);

  // 3. Oracle Config
  console.log("\n[3] Oracle Config...");
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    oracle.programId
  );
  await safeRpc("initialize Config", () =>
    oracle.methods
      .initialize({
        publisherBond: new BN(10_000_000_000),
        challengeBond: new BN(1_000_000_000),
        minPublishersPerDay: 1,
        submissionWindowStart: 20 * 3600,
        submissionWindowEnd: 24 * 3600 - 1,
        challengeWindowSeconds: 3600,
      })
      .accounts({
        admin: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      } as never)
      .rpc()
  );

  // 4. Constituent Registry
  console.log("\n[4] Constituent Registry (zero-copy init)...");
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

  // 5. Seed 3 demo constituents
  console.log("\n[5] Seeding 3 demo constituents...");
  const demos = [
    { idx: 0, name: "Umbreon VMAX AA", set: "ES", num: 215, price: 1_450 },
    { idx: 1, name: "Rayquaza VMAX AA", set: "ES", num: 218, price: 2_825 },
    { idx: 2, name: "Giratina V AA", set: "LO", num: 186, price: 3_085 },
  ];
  for (const d of demos) {
    await safeRpc(`slot ${d.idx} = ${d.name} @ $${d.price}`, () =>
      oracle.methods
        .updateConstituent(d.idx, {
          basePrice: new BN(d.price * 1_000_000),
          canonicalSearchHash: Array.from(Buffer.alloc(32)),
          setCode: fixedBytes(d.set, 8),
          variantCode: fixedBytes("AA", 8),
          collectorNumber: d.num,
          setTotal: 203,
        })
        .accounts({
          admin: wallet.publicKey,
        } as never)
        .rpc()
    );
  }

  // 6. Finalize registry
  console.log("\n[6] Finalize registry v1...");
  const today = Math.floor(Date.now() / 86_400_000);
  await safeRpc(`finalize_registry_update day=${today}`, () =>
    oracle.methods
      .finalizeRegistryUpdate(today)
      .accounts({
        admin: wallet.publicKey,
      } as never)
      .rpc()
  );

  // 7. Insurance Fund
  console.log("\n[7] Insurance Fund + Vault...");
  await safeRpc("initialize_insurance_fund", () =>
    perp.methods
      .initializeInsuranceFund()
      .accounts({
        usdcMint,
        admin: wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      } as never)
      .rpc()
  );

  // 8. Market (oracle_index_state PDA — may not exist yet, but the Pubkey is fixed)
  console.log("\n[8] Market...");
  const [indexStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("index_state")],
    oracle.programId
  );
  const [insuranceVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_vault")],
    perp.programId
  );
  await safeRpc("initialize_market (phase 1 params)", () =>
    perp.methods
      .initializeMarket({
        oracleIndexState: indexStatePda,
        usdcMint,
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
      })
      .accounts({
        usdcMint,
        admin: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      } as never)
      .rpc()
  );

  console.log("\n✓ Initialization complete.");
  console.log("");
  console.log("Save these for the dashboard / further scripts:");
  console.log(`  ORACLE_PROGRAM      ${oracle.programId.toBase58()}`);
  console.log(`  PERP_PROGRAM        ${perp.programId.toBase58()}`);
  console.log(`  CONFIG_PDA          ${configPda.toBase58()}`);
  console.log(`  REGISTRY_PDA        ${registryPda.toBase58()}`);
  console.log(`  INDEX_STATE_PDA     ${indexStatePda.toBase58()}`);
  console.log(`  USDC_MINT           ${usdcMint.toBase58()}`);
  console.log(`  USER_USDC_ATA       ${ata.toBase58()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
