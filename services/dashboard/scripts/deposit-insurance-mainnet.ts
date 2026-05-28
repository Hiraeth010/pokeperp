/**
 * GO-LIVE STEP: deposit USDC into the mainnet insurance fund. deposit_insurance
 * is permissionless (no admin needed) — the depositor signs and provides their
 * USDC account. Here the depositor is the deploy/admin wallet, so send the
 * insurance USDC to that wallet first.
 *
 * Run (from services/dashboard):
 *   RPC_URL="<mainnet>" AMOUNT_USDC=10000 \
 *     WALLET_PATH="../../mainnet-keys/deploy.json" \
 *     npx tsx scripts/deposit-insurance-mainnet.ts
 */
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "node:fs";
import PerpIdl from "../lib/idl/perp_engine.json";
import type { PerpEngine } from "../lib/idl/perp_engine";
import { resolveRpc } from "./rpc";

const RPC = resolveRpc();
const WALLET_PATH = process.env.WALLET_PATH ?? "../../mainnet-keys/deploy.json";
const AMOUNT_USDC = Number(process.env.AMOUNT_USDC ?? "10000");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const kp = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));

async function main(): Promise<void> {
  if (!RPC.includes("mainnet")) throw new Error(`Refusing: RPC not mainnet (${RPC})`);
  const depositor = kp(WALLET_PATH);
  const conn = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(depositor), { commitment: "confirmed" });
  const perp = new Program<PerpEngine>(PerpIdl as unknown as PerpEngine, provider);
  const pda = (s: string) => PublicKey.findProgramAddressSync([Buffer.from(s)], perp.programId)[0];

  const amount = new BN(Math.round(AMOUNT_USDC * 1e6));
  const depositorAta = getAssociatedTokenAddressSync(USDC_MINT, depositor.publicKey);
  const have = Number((await conn.getTokenAccountBalance(depositorAta)).value.amount) / 1e6;
  console.log("depositor:", depositor.publicKey.toBase58());
  console.log(`depositing ${AMOUNT_USDC} USDC (wallet holds ${have})`);
  if (have < AMOUNT_USDC) throw new Error(`insufficient USDC: have ${have}, need ${AMOUNT_USDC}`);

  const insuranceVault = pda("insurance_vault");
  const before = Number((await conn.getTokenAccountBalance(insuranceVault)).value.amount) / 1e6;
  const sig = await perp.methods
    .depositInsurance(amount)
    .accounts({
      insuranceFund: pda("insurance_fund"),
      insuranceVault,
      usdcMint: USDC_MINT,
      depositor: depositor.publicKey,
      depositorUsdcAccount: depositorAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as never)
    .rpc();
  const after = Number((await conn.getTokenAccountBalance(insuranceVault)).value.amount) / 1e6;
  console.log(`✓ deposited. insurance vault: $${before} → $${after}`);
  console.log("tx:", sig);
}

main().catch((e) => { console.error(e); process.exit(1); });
