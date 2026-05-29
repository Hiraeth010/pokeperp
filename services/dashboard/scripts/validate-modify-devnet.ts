/**
 * DEVNET validation for the v0.9 modify_position fix. Reproduces both exploit
 * directions against the live (upgraded) devnet program and asserts the fix:
 *   A) INCREASE after a favorable move -> entry_mark blends toward the current
 *      mark (NOT stale). Pre-fix: entry stayed == original (free back-dated PnL).
 *   B) DECREASE while underwater -> realized loss is swept to insurance and the
 *      remaining entry is unchanged. Pre-fix: no cash moved (loss avoided).
 *
 * Self-funds throwaway traders from id.json (also the devnet USDC mint
 * authority). Cleans up by closing all positions. DEVNET ONLY.
 *
 *   RPC_URL="<devnet>" npx tsx scripts/validate-modify-devnet.ts
 */
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import {
  Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL, Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, getOrCreateAssociatedTokenAccount, mintTo, getAccount,
} from "@solana/spl-token";
import * as fs from "node:fs";
import * as os from "node:os";
import PerpIdl from "../lib/idl/perp_engine.json";
import type { PerpEngine } from "../lib/idl/perp_engine";

const RPC = process.env.RPC_URL!;
const PERP = new PublicKey("Gtpv6K9Fi3pkYcYZEzqaS8DW2nqDwpwPf24Q1WxsQzsa");
const ORACLE = new PublicKey("GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i");
const idPath = process.env.WALLET_PATH ?? `${os.homedir()}/.config/solana/id.json`;
const id = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(idPath, "utf8"))));

const usd = (x: { toString(): string }) => "$" + (Number(x.toString()) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 });
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${name} — ${detail}`);
  ok ? pass++ : fail++;
};

async function main() {
  if (!RPC || !RPC.includes("devnet")) throw new Error(`Refusing: RPC must be devnet (${RPC})`);
  const conn = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(id), { commitment: "confirmed" });
  const perp = new Program<PerpEngine>(PerpIdl as unknown as PerpEngine, provider);

  const pda = (s: string, prog = PERP) => PublicKey.findProgramAddressSync([Buffer.from(s)], prog)[0];
  const marketPda = pda("market");
  const insuranceFundPda = pda("insurance_fund");
  const insuranceVaultPda = pda("insurance_vault");
  const treasuryPda = pda("treasury");
  const treasuryVaultPda = pda("treasury_vault");
  const indexStatePda = pda("index_state", ORACLE);
  const posPda = (t: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("position"), t.toBuffer(), marketPda.toBuffer()], PERP)[0];
  const mvPda = (t: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("margin_vault"), t.toBuffer(), marketPda.toBuffer()], PERP)[0];

  const market: any = await perp.account.market.fetch(marketPda);
  const usdcMint: PublicKey = market.usdcMint;
  console.log("devnet market: IM", market.initialMarginBps, "MM", market.maintenanceMarginBps, "| usdcMint", usdcMint.toBase58());
  console.log("starting OI:", usd(market.longOi), "/", usd(market.shortOi), "\n");

  async function spawnTrader(usdcAmt: bigint) {
    const kp = Keypair.generate();
    await provider.sendAndConfirm(new Transaction().add(SystemProgram.transfer({
      fromPubkey: id.publicKey, toPubkey: kp.publicKey, lamports: 0.25 * LAMPORTS_PER_SOL,
    })), []);
    const ata = await getOrCreateAssociatedTokenAccount(conn, id, usdcMint, kp.publicKey);
    await mintTo(conn, id, usdcMint, ata.address, id, usdcAmt);
    return { kp, ata: ata.address };
  }
  const open = (t: Keypair, ata: PublicKey, size: BN, margin: BN) => perp.methods.openPosition(size, margin).accounts({
    market: marketPda, trader: t.publicKey, position: posPda(t.publicKey), marginVault: mvPda(t.publicKey),
    traderUsdcAccount: ata, insuranceVault: insuranceVaultPda, insuranceFund: insuranceFundPda,
    treasuryVault: treasuryVaultPda, treasury: treasuryPda, usdcMint, indexState: indexStatePda,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  } as never).signers([t]).rpc();
  const modify = (t: Keypair, delta: BN) => perp.methods.modifyPosition(delta).accounts({
    market: marketPda, trader: t.publicKey, position: posPda(t.publicKey), marginVault: mvPda(t.publicKey),
    insuranceFund: insuranceFundPda, insuranceVault: insuranceVaultPda, indexState: indexStatePda,
    tokenProgram: TOKEN_PROGRAM_ID,
  } as never).signers([t]).rpc();
  const close = (t: Keypair, ata: PublicKey) => perp.methods.closePosition().accounts({
    market: marketPda, trader: t.publicKey, position: posPda(t.publicKey), marginVault: mvPda(t.publicKey),
    traderUsdcAccount: ata, usdcMint, insuranceFund: insuranceFundPda, insuranceVault: insuranceVaultPda,
    treasuryVault: treasuryVaultPda, treasury: treasuryPda, indexState: indexStatePda, tokenProgram: TOKEN_PROGRAM_ID,
  } as never).signers([t]).rpc();
  const entryOf = async (t: Keypair) => new BN((await perp.account.position.fetch(posPda(t.publicKey))).entryMarkPrice.toString());
  const vbal = async (p: PublicKey) => BigInt((await getAccount(conn, p)).amount);

  const A = await spawnTrader(6_000_000_000n);
  const B = await spawnTrader(60_000_000_000n);
  console.log("traders funded: A", A.kp.publicKey.toBase58().slice(0, 8), "B", B.kp.publicKey.toBase58().slice(0, 8), "\n");

  // ---- Scenario A: increase blends entry ----
  await open(A.kp, A.ata, new BN(2_000_000_000), new BN(2_000_000_000)); // 2k long, 2k margin
  const e1 = await entryOf(A.kp);
  await open(B.kp, B.ata, new BN(40_000_000_000), new BN(14_000_000_000)); // 40k long -> pushes mark up
  await modify(A.kp, new BN(2_000_000_000)); // +2k -> size 4k
  const e2 = await entryOf(A.kp);
  const sizeA = (await perp.account.position.fetch(posPda(A.kp.publicKey))).size.toString();
  const impliedModifyMark = e2.muln(4).sub(e1.muln(2)).divn(2); // (e2*4k - e1*2k)/2k
  check("A. increase blends entry up (not stale)", e2.gt(e1),
    `entry ${usd(e1)} -> ${usd(e2)} (implied add-mark ${usd(impliedModifyMark)}); size now ${usd(new BN(sizeA))}`);

  // ---- Scenario B: decrease while underwater realizes loss to insurance ----
  await close(B.kp, B.ata); // drop long OI -> mark falls below A's blended entry -> A underwater
  const insBefore = await vbal(insuranceVaultPda);
  const mvBefore = await vbal(mvPda(A.kp.publicKey));
  const entryBefore = await entryOf(A.kp);
  await modify(A.kp, new BN(-2_000_000_000)); // -2k -> size 2k
  const insAfter = await vbal(insuranceVaultPda);
  const mvAfter = await vbal(mvPda(A.kp.publicKey));
  const entryAfter = await entryOf(A.kp);
  check("B. decrease sweeps realized loss to insurance", insAfter > insBefore,
    `insurance ${usd(insBefore.toString())} -> ${usd(insAfter.toString())} (+${usd((insAfter - insBefore).toString())})`);
  check("B. decrease debits trader margin vault", mvAfter < mvBefore,
    `margin ${usd(mvBefore.toString())} -> ${usd(mvAfter.toString())} (-${usd((mvBefore - mvAfter).toString())})`);
  check("B. decrease leaves remaining entry unchanged", entryAfter.eq(entryBefore),
    `entry ${usd(entryBefore)} -> ${usd(entryAfter)}`);

  // ---- cleanup ----
  try { await close(A.kp, A.ata); console.log("\ncleanup: closed A"); } catch (e: any) { console.log("cleanup A close err:", e?.message); }
  const m2: any = await perp.account.market.fetch(marketPda);
  console.log("ending OI:", usd(m2.longOi), "/", usd(m2.shortOi));

  console.log(`\n===== ${fail === 0 ? "ALL PASS" : "FAILURES"} : ${pass} passed, ${fail} failed =====`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error("ERR", e?.message ?? e); console.error(e?.stack); process.exit(1); });
