/**
 * Register the operator publisher on MAINNET.
 * Admin escrows the Config publisher_bond (100 USDC) from its USDC ATA into the
 * publisher's bond vault and creates the Publisher PDA (status Shadow, eligible
 * to submit). Idempotent — no-op if already registered.
 *
 * Run (from services/dashboard):
 *   RPC_URL="<mainnet>" WALLET_PATH="D:\\pokeperp\\mainnet-keys\\deploy.json" \
 *     npx tsx scripts/register-publisher-mainnet.ts
 */
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as fs from "node:fs";
import * as path from "node:path";

import OracleIdl from "../lib/idl/oracle.json";
import type { Oracle } from "../lib/idl/oracle";
import { resolveRpc } from "./rpc";

const RPC = resolveRpc();
const ADMIN_WALLET = process.env.WALLET_PATH ?? "/d/pokeperp/mainnet-keys/deploy.json";
const PUBLISHER_KEY = process.env.PUBLISHER_KEY ?? "/d/pokeperp/mainnet-keys/publisher.json";
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

async function main(): Promise<void> {
  if (!RPC.includes("mainnet")) throw new Error(`Refusing: RPC not mainnet (${RPC})`);
  const admin = loadKeypair(ADMIN_WALLET);
  const publisher = loadKeypair(PUBLISHER_KEY);
  const connection = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(admin), { commitment: "confirmed" });
  const oracle = new Program<Oracle>(OracleIdl as unknown as Oracle, provider);

  console.log("Admin:    ", admin.publicKey.toBase58());
  console.log("Publisher:", publisher.publicKey.toBase58());

  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], oracle.programId);
  const [publisherPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("publisher"), publisher.publicKey.toBuffer()],
    oracle.programId
  );
  const [bondVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bond_vault"), publisher.publicKey.toBuffer()],
    oracle.programId
  );
  const adminUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, admin.publicKey);

  const cfg = await oracle.account.config.fetch(configPda);
  const bond = Number(cfg.publisherBond.toString());
  const adminUsdc = Number((await connection.getTokenAccountBalance(adminUsdcAta)).value.amount);
  console.log(`Bond required: ${bond / 1e6} USDC | admin holds: ${adminUsdc / 1e6} USDC`);
  if (adminUsdc < bond) throw new Error("Admin USDC below required bond");

  const existing = await oracle.account.publisher.fetchNullable(publisherPda);
  if (existing) {
    console.log(`- already registered (status ${Object.keys(existing.status as object)[0]}, bond ${Number(existing.bondAmount.toString()) / 1e6} USDC)`);
  } else {
    const sig = await oracle.methods
      .registerPublisher(publisher.publicKey)
      .accounts({
        config: configPda,
        admin: admin.publicKey,
        publisherAccount: publisherPda,
        adminUsdcAccount: adminUsdcAta,
        bondVault: bondVaultPda,
        usdcMint: USDC_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as never)
      .rpc();
    const fresh = await oracle.account.publisher.fetch(publisherPda);
    console.log(`✓ registered, sig: ${sig}`);
    console.log(`  status: ${Object.keys(fresh.status as object)[0]}  bond: ${Number(fresh.bondAmount.toString()) / 1e6} USDC  joined_day: ${fresh.joinedDay}`);
  }
  console.log(`Publisher PDA: ${publisherPda.toBase58()}`);
  console.log(`Bond vault:    ${bondVaultPda.toBase58()}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
