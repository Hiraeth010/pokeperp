/**
 * Step 3 (final): accept_admin_transfer() executed THROUGH the Squad, so the
 * vault PDA — the proposed new admin — actually signs. For each program this
 * runs the full multisig flow: vaultTransactionCreate → proposalCreate →
 * proposalApprove (x2, threshold) → vaultTransactionExecute. Proves the 2-of-3
 * can act before authority is committed.
 *
 * feePayer = id.json for every tx, so the co-signers only co-sign (no SOL needed).
 *
 * Run: npx tsx scripts/squads/accept-admin-transfer.ts
 */
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  TransactionInstruction,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import * as multisig from "@sqds/multisig";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import url from "node:url";
import { resolveRpc } from "../rpc";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ORACLE = new PublicKey("GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i");
const PERP = new PublicKey("Gtpv6K9Fi3pkYcYZEzqaS8DW2nqDwpwPf24Q1WxsQzsa");
const kp = (p: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));

async function main() {
  const admin = kp(path.join(os.homedir(), ".config", "solana", "id.json"));
  const cosigner1 = kp(path.join(HERE, "keys", "cosigner-1.json"));
  const { multisigPda: msStr, vaultPda: vaultStr } = JSON.parse(
    readFileSync(path.join(HERE, "multisig.json"), "utf8"),
  );
  const multisigPda = new PublicKey(msStr);
  const vault = new PublicKey(vaultStr);

  const conn = new Connection(resolveRpc(), "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(admin), {
    commitment: "confirmed",
  });
  const oracleIdl = JSON.parse(readFileSync(path.join(HERE, "..", "..", "lib", "idl", "oracle.json"), "utf8"));
  const perpIdl = JSON.parse(readFileSync(path.join(HERE, "..", "..", "lib", "idl", "perp_engine.json"), "utf8"));
  const oracle = new Program(oracleIdl, provider);
  const perp = new Program(perpIdl, provider);
  const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], ORACLE)[0];
  const marketPda = PublicKey.findProgramAddressSync([Buffer.from("market")], PERP)[0];

  const acceptOracleIx: TransactionInstruction = await oracle.methods
    .acceptAdminTransfer()
    .accounts({ config: configPda, newAdmin: vault })
    .instruction();
  const acceptPerpIx: TransactionInstruction = await perp.methods
    .acceptAdminTransfer()
    .accounts({ market: marketPda, newAdmin: vault })
    .instruction();

  async function runThroughSquad(label: string, ix: TransactionInstruction) {
    const ms = await multisig.accounts.Multisig.fromAccountAddress(conn, multisigPda);
    const transactionIndex = BigInt(ms.transactionIndex.toString()) + 1n;
    console.log(`\n[${label}] transactionIndex ${transactionIndex}`);

    const { blockhash } = await conn.getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: vault,
      recentBlockhash: blockhash,
      instructions: [ix],
    });

    let sig = await multisig.rpc.vaultTransactionCreate({
      connection: conn,
      feePayer: admin,
      multisigPda,
      transactionIndex,
      creator: admin.publicKey,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage: message,
    });
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`  vaultTransactionCreate: ${sig}`);

    sig = await multisig.rpc.proposalCreate({
      connection: conn,
      feePayer: admin,
      creator: admin,
      multisigPda,
      transactionIndex,
    });
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`  proposalCreate: ${sig}`);

    sig = await multisig.rpc.proposalApprove({
      connection: conn,
      feePayer: admin,
      member: admin,
      multisigPda,
      transactionIndex,
    });
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`  approve 1/2 (admin): ${sig}`);

    sig = await multisig.rpc.proposalApprove({
      connection: conn,
      feePayer: admin,
      member: cosigner1,
      multisigPda,
      transactionIndex,
    });
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`  approve 2/2 (cosigner-1): ${sig}`);

    sig = await multisig.rpc.vaultTransactionExecute({
      connection: conn,
      feePayer: admin,
      multisigPda,
      transactionIndex,
      member: admin.publicKey,
    });
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`  execute: ${sig}`);
  }

  await runThroughSquad("oracle accept", acceptOracleIx);
  await runThroughSquad("perp accept", acceptPerpIx);

  const cfg = await oracle.account.config.fetch(configPda);
  const mkt = await perp.account.market.fetch(marketPda);
  console.log("\n=== RESULT ===");
  console.log("oracle Config.admin:", cfg.admin.toBase58(), cfg.admin.equals(vault) ? "== vault ✓" : "✗");
  console.log("perp Market.admin:  ", mkt.admin.toBase58(), mkt.admin.equals(vault) ? "== vault ✓" : "✗");
  console.log("oracle pending cleared:", cfg.pendingAdmin.toBase58());
  console.log("perp pending cleared:  ", mkt.pendingAdmin.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
