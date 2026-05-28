/**
 * Create the MAINNET 2-of-3 Squads V4 multisig. Members are the three fresh
 * mainnet signer keys (mainnet-keys/signer-{1,2,3}.json); the deploy wallet is
 * the creator/fee-payer only (NOT a member). Threshold 2.
 *
 * This only CREATES the multisig — it does not touch protocol admin. The admin
 * migration (migrate-admin-mainnet.ts) is a separate, deliberate go-live step.
 *
 * Run (from services/dashboard):
 *   RPC_URL="<mainnet>" npx tsx scripts/squads/create-multisig-mainnet.ts
 * Writes scripts/squads/multisig.mainnet.json (public, committable).
 */
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { resolveRpc } from "../rpc";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const KEYS = path.join(HERE, "..", "..", "..", "..", "mainnet-keys");
const kp = (p: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));

async function main() {
  const rpc = resolveRpc();
  if (!rpc.includes("mainnet")) throw new Error(`Refusing: RPC not mainnet (${rpc})`);

  const payer = kp(path.join(KEYS, "deploy.json"));
  const s1 = kp(path.join(KEYS, "signer-1.json"));
  const s2 = kp(path.join(KEYS, "signer-2.json"));
  const s3 = kp(path.join(KEYS, "signer-3.json"));
  const THRESHOLD = 2;

  const conn = new Connection(rpc, "confirmed");
  const { Permissions } = multisig.types;
  const members = [
    { key: s1.publicKey, permissions: Permissions.all() },
    { key: s2.publicKey, permissions: Permissions.all() },
    { key: s3.publicKey, permissions: Permissions.all() },
  ];

  console.log("creator/payer (deploy):", payer.publicKey.toBase58());
  members.forEach((m, i) => console.log(`signer-${i + 1}:`, m.key.toBase58()));
  console.log("threshold:", THRESHOLD, "of", members.length);
  console.log("payer SOL:", (await conn.getBalance(payer.publicKey) / LAMPORTS_PER_SOL).toFixed(4));

  const createKey = Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  const programConfigPda = multisig.getProgramConfigPda({})[0];
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(conn, programConfigPda);

  console.log("\ncreating multisig...");
  const sig = await multisig.rpc.multisigCreateV2({
    connection: conn,
    treasury: programConfig.treasury,
    createKey,
    creator: payer,
    multisigPda,
    configAuthority: null, // autonomous
    threshold: THRESHOLD,
    members,
    timeLock: 0,
    rentCollector: null,
  });
  await conn.confirmTransaction(sig, "confirmed");

  console.log("tx:", sig);
  console.log("multisigPda:", multisigPda.toBase58());
  console.log("vaultPda (index 0) — becomes protocol admin at go-live:", vaultPda.toBase58());

  const info = {
    cluster: "mainnet-beta",
    multisigPda: multisigPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    threshold: THRESHOLD,
    members: members.map((m) => m.key.toBase58()),
    createTx: sig,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(path.join(HERE, "multisig.mainnet.json"), JSON.stringify(info, null, 2) + "\n");
  console.log("\nwrote scripts/squads/multisig.mainnet.json");
  console.log("explorer:", `https://explorer.solana.com/address/${multisigPda.toBase58()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
