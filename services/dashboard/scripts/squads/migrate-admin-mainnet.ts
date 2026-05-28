/**
 * GO-LIVE STEP (run when ready to lock down admin): migrate oracle Config.admin
 * and perp Market.admin from the deploy wallet to the mainnet Squad vault.
 *
 *   propose_admin_transfer(vault)  — signed by current admin (deploy wallet)
 *   accept_admin_transfer()        — executed THROUGH the Squad (vault signs),
 *                                    approved by signer-1 + signer-2, paid by deploy.
 *
 * After this, admin actions (e.g. set_pause to enable trading) require a 2-of-3
 * multisig flow. NOTE: this does NOT move the program upgrade authority — that's
 * a separate `solana program set-upgrade-authority` step, intentionally deferred
 * until after the validation period so patches stay easy.
 *
 * Run (from services/dashboard):
 *   RPC_URL="<mainnet>" npx tsx scripts/squads/migrate-admin-mainnet.ts
 */
import {
  Connection, Keypair, PublicKey, TransactionMessage, TransactionInstruction,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import * as multisig from "@sqds/multisig";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { resolveRpc } from "../rpc";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const KEYS = path.join(HERE, "..", "..", "..", "..", "mainnet-keys");
const ORACLE = new PublicKey("GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i");
const PERP = new PublicKey("Gtpv6K9Fi3pkYcYZEzqaS8DW2nqDwpwPf24Q1WxsQzsa");
const kp = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));

async function main() {
  const rpc = resolveRpc();
  if (!rpc.includes("mainnet")) throw new Error(`Refusing: RPC not mainnet (${rpc})`);

  const deploy = kp(path.join(KEYS, "deploy.json"));
  const s1 = kp(path.join(KEYS, "signer-1.json"));
  const s2 = kp(path.join(KEYS, "signer-2.json"));
  const { multisigPda: msStr, vaultPda: vaultStr } = JSON.parse(
    readFileSync(path.join(HERE, "multisig.mainnet.json"), "utf8"));
  const multisigPda = new PublicKey(msStr);
  const vault = new PublicKey(vaultStr);

  const conn = new Connection(rpc, "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(deploy), { commitment: "confirmed" });
  const oracleIdl = JSON.parse(readFileSync(path.join(HERE, "..", "..", "lib", "idl", "oracle.json"), "utf8"));
  const perpIdl = JSON.parse(readFileSync(path.join(HERE, "..", "..", "lib", "idl", "perp_engine.json"), "utf8"));
  const oracle = new Program(oracleIdl, provider);
  const perp = new Program(perpIdl, provider);
  const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], ORACLE)[0];
  const marketPda = PublicKey.findProgramAddressSync([Buffer.from("market")], PERP)[0];

  // ---- Step 1: propose (current admin = deploy) ----
  console.log("proposing admin transfer to vault", vault.toBase58());
  console.log("  oracle:", await oracle.methods.proposeAdminTransfer(vault)
    .accounts({ config: configPda, admin: deploy.publicKey }).rpc());
  console.log("  perp:  ", await perp.methods.proposeAdminTransfer(vault)
    .accounts({ market: marketPda, admin: deploy.publicKey }).rpc());

  // ---- Step 2: accept through the Squad ----
  const acceptOracleIx = await oracle.methods.acceptAdminTransfer()
    .accounts({ config: configPda, newAdmin: vault }).instruction();
  const acceptPerpIx = await perp.methods.acceptAdminTransfer()
    .accounts({ market: marketPda, newAdmin: vault }).instruction();

  async function runThroughSquad(label: string, ix: TransactionInstruction) {
    const ms = await multisig.accounts.Multisig.fromAccountAddress(conn, multisigPda);
    const transactionIndex = BigInt(ms.transactionIndex.toString()) + 1n;
    const { blockhash } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({ payerKey: vault, recentBlockhash: blockhash, instructions: [ix] });
    console.log(`\n[${label}] txIndex ${transactionIndex}`);

    await conn.confirmTransaction(await multisig.rpc.vaultTransactionCreate({
      connection: conn, feePayer: deploy, multisigPda, transactionIndex,
      creator: s1.publicKey, vaultIndex: 0, ephemeralSigners: 0, transactionMessage: message,
    }), "confirmed");
    await conn.confirmTransaction(await multisig.rpc.proposalCreate({
      connection: conn, feePayer: deploy, creator: s1, multisigPda, transactionIndex,
    }), "confirmed");
    await conn.confirmTransaction(await multisig.rpc.proposalApprove({
      connection: conn, feePayer: deploy, member: s1, multisigPda, transactionIndex,
    }), "confirmed");
    await conn.confirmTransaction(await multisig.rpc.proposalApprove({
      connection: conn, feePayer: deploy, member: s2, multisigPda, transactionIndex,
    }), "confirmed");
    await conn.confirmTransaction(await multisig.rpc.vaultTransactionExecute({
      connection: conn, feePayer: deploy, multisigPda, transactionIndex, member: s1.publicKey,
    }), "confirmed");
    console.log(`  ✓ executed`);
  }

  await runThroughSquad("oracle accept", acceptOracleIx);
  await runThroughSquad("perp accept", acceptPerpIx);

  const cfg = await oracle.account.config.fetch(configPda);
  const mkt = await perp.account.market.fetch(marketPda);
  console.log("\n=== RESULT ===");
  console.log("oracle Config.admin:", cfg.admin.toBase58(), cfg.admin.equals(vault) ? "== vault ✓" : "✗");
  console.log("perp Market.admin:  ", mkt.admin.toBase58(), mkt.admin.equals(vault) ? "== vault ✓" : "✗");
}

main().catch((e) => { console.error(e); process.exit(1); });
