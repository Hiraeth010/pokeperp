/**
 * DEVNET ONE-SHOT: transfer oracle Config.admin from the Squad vault back to
 * id.json so the 50-card expansion migration (expand_constituents_to_50 +
 * 25× update_constituent + finalize_registry_update) can run direct-signed
 * instead of Squad-routed-batched. Devnet only; mainnet still routes through
 * the Squad when migrated there. We don't transfer perp Market.admin — only
 * oracle changed for v0.10.
 *
 * Flow:
 *   propose_admin_transfer(id.json) — Squad-routed (vault is current admin)
 *   accept_admin_transfer()         — id.json signs directly
 *
 * Run (from services/dashboard):
 *   RPC_URL="<devnet>" npx tsx scripts/squads/squad-revert-oracle-admin-devnet.ts
 */
import {
  Connection, Keypair, PublicKey, TransactionMessage, TransactionInstruction,
  SendTransactionError,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import * as multisig from "@sqds/multisig";

// @sqds/multisig v2.1.4 does `translatedError.logs = err.logs` in its error
// translator, but @solana/web3.js's SendTransactionError exposes `.logs` as a
// getter-only property. Replace the prototype's `logs` accessor with a writable
// data property so the SDK can rethrow the REAL on-chain error instead of
// masking it with "Cannot set property logs of Error which has only a getter".
Object.defineProperty(SendTransactionError.prototype, "logs", {
  writable: true, configurable: true, enumerable: false, value: undefined,
});
Object.defineProperty(Error.prototype, "logs", {
  writable: true, configurable: true, enumerable: false, value: undefined,
});
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import url from "node:url";
import { resolveRpc } from "../rpc";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ORACLE = new PublicKey("GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i");
const kp = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));

async function main() {
  const rpc = resolveRpc();
  if (!rpc.includes("devnet")) throw new Error(`Refusing: RPC not devnet (${rpc})`);

  const id = kp(path.join(os.homedir(), ".config", "solana", "id.json"));
  const s1 = kp(path.join(HERE, "keys", "cosigner-1.json"));
  const s2 = kp(path.join(HERE, "keys", "cosigner-2.json"));
  const { multisigPda: msStr, vaultPda: vaultStr } = JSON.parse(
    readFileSync(path.join(HERE, "multisig.json"), "utf8"));
  const multisigPda = new PublicKey(msStr);
  const vault = new PublicKey(vaultStr);
  console.log("devnet Squad vault:", vault.toBase58());
  console.log("transferring oracle Config.admin →", id.publicKey.toBase58(), "(id.json)");

  const conn = new Connection(rpc, "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(id), { commitment: "confirmed" });
  const oracleIdl = JSON.parse(readFileSync(path.join(HERE, "..", "..", "lib", "idl", "oracle.json"), "utf8"));
  const oracle = new Program(oracleIdl, provider);
  const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], ORACLE)[0];

  // ---- Step 1: Squad-routed propose_admin_transfer(id.json) ----
  // Current admin = vault, so the propose ix must be signed by the vault.
  const proposeIx: TransactionInstruction = await oracle.methods
    .proposeAdminTransfer(id.publicKey)
    .accounts({ config: configPda, admin: vault })
    .instruction();

  const ms = await multisig.accounts.Multisig.fromAccountAddress(conn, multisigPda);
  const transactionIndex = BigInt(ms.transactionIndex.toString()) + 1n;
  const { blockhash } = await conn.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: vault, recentBlockhash: blockhash, instructions: [proposeIx],
  });
  console.log(`\n[squad propose] txIndex ${transactionIndex}`);

  await conn.confirmTransaction(await multisig.rpc.vaultTransactionCreate({
    connection: conn, feePayer: id, multisigPda, transactionIndex,
    creator: s1.publicKey, rentPayer: id.publicKey, vaultIndex: 0,
    ephemeralSigners: 0, transactionMessage: message, signers: [s1],
  }), "confirmed");
  console.log("  ✓ vault tx created");
  await conn.confirmTransaction(await multisig.rpc.proposalCreate({
    connection: conn, feePayer: id, creator: s1, multisigPda, transactionIndex,
  }), "confirmed");
  console.log("  ✓ proposal created");
  await conn.confirmTransaction(await multisig.rpc.proposalApprove({
    connection: conn, feePayer: id, member: s1, multisigPda, transactionIndex,
  }), "confirmed");
  console.log("  ✓ approved by s1");
  await conn.confirmTransaction(await multisig.rpc.proposalApprove({
    connection: conn, feePayer: id, member: s2, multisigPda, transactionIndex,
  }), "confirmed");
  console.log("  ✓ approved by s2 (threshold reached)");
  await conn.confirmTransaction(await multisig.rpc.vaultTransactionExecute({
    connection: conn, feePayer: id, multisigPda, transactionIndex, member: s1.publicKey,
    signers: [s1],
  }), "confirmed");
  console.log("  ✓ executed — pending_admin is now id.json");

  // ---- Step 2: id.json accepts ----
  console.log("\n[id.json accept]");
  const acceptSig = await oracle.methods
    .acceptAdminTransfer()
    .accounts({ config: configPda, newAdmin: id.publicKey })
    .rpc();
  console.log("  ✓ accept tx:", acceptSig);

  // ---- Verify ----
  const cfg: any = await oracle.account.config.fetch(configPda);
  console.log("\n=== RESULT ===");
  console.log("oracle Config.admin:", cfg.admin.toBase58(), cfg.admin.equals(id.publicKey) ? "== id.json ✓" : "✗");
  console.log("oracle Config.pending_admin:", cfg.pendingAdmin.toBase58(), "(should be 1111... default)");
}

main().catch((e) => { console.error(e); process.exit(1); });
