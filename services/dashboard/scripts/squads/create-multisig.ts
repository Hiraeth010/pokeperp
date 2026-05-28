/**
 * Create a 2-of-3 Squads V4 multisig on devnet and migrate the protocol admin
 * to its vault PDA. Step 1: create the multisig.
 *
 * Members: the current protocol admin (~/.config/solana/id.json) + the two
 * co-signers in ./keys/cosigner-{1,2}.json. Threshold 2.
 *
 * Run: npx tsx scripts/squads/create-multisig.ts
 * Writes the resulting addresses to scripts/squads/multisig.json (public, committable).
 */
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import url from "node:url";
import { resolveRpc } from "../rpc";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const kp = (p: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));

async function main() {
  const admin = kp(path.join(os.homedir(), ".config", "solana", "id.json"));
  const cosigner1 = kp(path.join(HERE, "keys", "cosigner-1.json"));
  const cosigner2 = kp(path.join(HERE, "keys", "cosigner-2.json"));
  const THRESHOLD = 2;

  const conn = new Connection(resolveRpc(), "confirmed");
  const { Permissions } = multisig.types;

  const members = [
    { key: admin.publicKey, permissions: Permissions.all() },
    { key: cosigner1.publicKey, permissions: Permissions.all() },
    { key: cosigner2.publicKey, permissions: Permissions.all() },
  ];

  console.log("admin (creator/payer):", admin.publicKey.toBase58());
  console.log("cosigner-1:", cosigner1.publicKey.toBase58());
  console.log("cosigner-2:", cosigner2.publicKey.toBase58());
  console.log("threshold:", THRESHOLD, "of", members.length);

  const bal = await conn.getBalance(admin.publicKey);
  console.log("admin SOL:", (bal / LAMPORTS_PER_SOL).toFixed(4));

  const createKey = Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
  });
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

  const programConfigPda = multisig.getProgramConfigPda({})[0];
  const programConfig =
    await multisig.accounts.ProgramConfig.fromAccountAddress(
      conn,
      programConfigPda,
    );

  console.log("\ncreating multisig...");
  const sig = await multisig.rpc.multisigCreateV2({
    connection: conn,
    treasury: programConfig.treasury,
    createKey,
    creator: admin,
    multisigPda,
    configAuthority: null, // autonomous — controlled by the multisig itself
    threshold: THRESHOLD,
    members,
    timeLock: 0,
    rentCollector: null,
  });
  await conn.confirmTransaction(sig, "confirmed");

  console.log("tx:", sig);
  console.log("multisigPda:", multisigPda.toBase58());
  console.log(
    "vaultPda (index 0) — this becomes the protocol admin:",
    vaultPda.toBase58(),
  );

  const info = {
    cluster: "devnet",
    multisigPda: multisigPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    threshold: THRESHOLD,
    members: members.map((m) => m.key.toBase58()),
    createTx: sig,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(
    path.join(HERE, "multisig.json"),
    JSON.stringify(info, null, 2) + "\n",
  );
  console.log("\nwrote scripts/squads/multisig.json");
  console.log(
    "explorer:",
    `https://explorer.solana.com/address/${multisigPda.toBase58()}?cluster=devnet`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
