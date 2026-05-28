/**
 * Step 2 of the admin migration: propose_admin_transfer(vault) on the oracle
 * Config and the perp Market, signed by the CURRENT admin (id.json). This is
 * reversible — it only sets pending_admin; the current admin keeps control until
 * the Squad accepts (accept-admin-transfer.ts).
 *
 * Run: npx tsx scripts/squads/propose-admin-transfer.ts
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import url from "node:url";
import { resolveRpc } from "../rpc";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ORACLE = new PublicKey("GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i");
const PERP = new PublicKey("Gtpv6K9Fi3pkYcYZEzqaS8DW2nqDwpwPf24Q1WxsQzsa");

async function main() {
  const admin = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(
        readFileSync(path.join(os.homedir(), ".config", "solana", "id.json"), "utf8"),
      ),
    ),
  );
  const { vaultPda } = JSON.parse(
    readFileSync(path.join(HERE, "multisig.json"), "utf8"),
  );
  const vault = new PublicKey(vaultPda);
  console.log("current admin:", admin.publicKey.toBase58());
  console.log("proposing new admin (Squad vault):", vault.toBase58());

  const conn = new Connection(resolveRpc(), "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(admin), {
    commitment: "confirmed",
  });
  const oracleIdl = JSON.parse(
    readFileSync(path.join(HERE, "..", "..", "lib", "idl", "oracle.json"), "utf8"),
  );
  const perpIdl = JSON.parse(
    readFileSync(path.join(HERE, "..", "..", "lib", "idl", "perp_engine.json"), "utf8"),
  );
  const oracle = new Program(oracleIdl, provider);
  const perp = new Program(perpIdl, provider);
  const configPda = PublicKey.findProgramAddressSync([Buffer.from("config")], ORACLE)[0];
  const marketPda = PublicKey.findProgramAddressSync([Buffer.from("market")], PERP)[0];

  const sig1 = await oracle.methods
    .proposeAdminTransfer(vault)
    .accounts({ config: configPda, admin: admin.publicKey })
    .rpc();
  console.log("oracle propose tx:", sig1);

  const sig2 = await perp.methods
    .proposeAdminTransfer(vault)
    .accounts({ market: marketPda, admin: admin.publicKey })
    .rpc();
  console.log("perp propose tx:", sig2);

  // Verify pending_admin set on both
  const cfg = await oracle.account.config.fetch(configPda);
  const mkt = await perp.account.market.fetch(marketPda);
  console.log("\noracle Config.pending_admin:", cfg.pendingAdmin.toBase58(), cfg.pendingAdmin.equals(vault) ? "✓" : "✗");
  console.log("perp Market.pending_admin:", mkt.pendingAdmin.toBase58(), mkt.pendingAdmin.equals(vault) ? "✓" : "✗");
  console.log("\ncurrent admins still:", cfg.admin.toBase58(), "/", mkt.admin.toBase58(), "(unchanged until accept)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
