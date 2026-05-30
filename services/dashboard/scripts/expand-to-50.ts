/**
 * v0.10 50-card migration: reallocs the on-chain ConstituentRegistry +
 * IndexState from N=25 to N=50, then populates slots 25..49 with the
 * validated PMT26-50 list, then finalizes the registry update.
 *
 * Admin-only — requires WALLET_PATH to be the current Config.admin (id.json
 * on devnet, deploy.json on mainnet). On devnet, admin must first be reverted
 * from the Squad vault via squad-revert-oracle-admin-devnet.ts.
 *
 * Run (devnet):
 *   RPC_URL="<devnet>" WALLET_PATH=~/.config/solana/id.json npx tsx scripts/expand-to-50.ts
 */
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "node:fs";
import * as os from "node:os";

const RPC = process.env.RPC_URL!;
const WALLET_PATH = process.env.WALLET_PATH ?? `${os.homedir()}/.config/solana/id.json`;
const ORACLE = new PublicKey("GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i");

const fixedBytes = (s: string, n: number) => {
  const b = Buffer.alloc(n); Buffer.from(s, "utf8").copy(b); return Array.from(b);
};

// PMT26-50 — validated via trailing 90-day eBay sold $ volume.
const NEW_25 = [
  { name: "Lugia VSTAR AA",        set: "ST",  num: 211, variant: "AA",  total: 195, price: 1094 },
  { name: "Pikachu ex SIR 151",    set: "PMK", num: 193, variant: "SIR", total: 165, price:  899 },
  { name: "Blastoise ex SIR",      set: "PMK", num: 200, variant: "SIR", total: 165, price:  675 },
  { name: "Venusaur ex SIR",       set: "PMK", num: 198, variant: "SIR", total: 165, price:  500 },
  { name: "Alakazam ex SIR",       set: "PMK", num: 201, variant: "SIR", total: 165, price:  350 },
  { name: "Mew ex SIR",            set: "PMK", num: 205, variant: "SIR", total: 165, price:  360 },
  { name: "Giratina VSTAR AA",     set: "LO",  num: 213, variant: "AA",  total: 196, price:  650 },
  { name: "Pikachu ex SIR SS",     set: "SS",  num: 238, variant: "SIR", total: 252, price: 1050 },
  { name: "Pikachu V-UNION",       set: "CEL", num:  25, variant: "UN",  total:  25, price:  290 },
  { name: "Charizard VSTAR GG",    set: "CZ",  num:  29, variant: "GG",  total:  70, price:  275 },
  { name: "Pikachu VMAX GG",       set: "CZ",  num:  44, variant: "GG",  total:  70, price:  160 },
  { name: "Rayquaza VMAX GG",      set: "CZ",  num:  50, variant: "GG",  total:  70, price:   94 },
  { name: "Zacian V GG",           set: "CZ",  num:  51, variant: "GG",  total:  70, price:  110 },
  { name: "Origin Palkia VSTAR AA",set: "AR",  num: 211, variant: "AA",  total: 189, price:  250 },
  { name: "Origin Dialga VSTAR AA",set: "AR",  num: 209, variant: "AA",  total: 189, price:  183 },
  { name: "Hisuian Goodra V AA",   set: "AR",  num: 205, variant: "AA",  total: 189, price:  175 },
  { name: "Arceus VSTAR AA",       set: "BS",  num: 184, variant: "AA",  total: 172, price:  175 },
  { name: "Lance's Charizard ex",  set: "SC",  num: 232, variant: "SAR", total: 142, price:  159 },
  { name: "Radiant Charizard",     set: "PGO", num:  11, variant: "RR",  total:  78, price:  135 },
  { name: "Mewtwo VSTAR PGO",      set: "PGO", num:  86, variant: "AA",  total:  78, price:  124 },
  { name: "Penny SAR",             set: "PaF", num:  91, variant: "SAR", total:  91, price:  125 },
  { name: "Hydreigon ex SIR",      set: "TM",  num: 167, variant: "SIR", total: 167, price:  126 },
  { name: "Mela SAR",              set: "PR",  num: 191, variant: "SAR", total: 182, price:  120 },
  { name: "Boss's Orders SAR",     set: "PaE", num: 270, variant: "SAR", total: 193, price:   71 },
  { name: "Tyranitar ex SIR",      set: "OF",  num: 226, variant: "SIR", total: 197, price:   70 },
];

async function main() {
  if (!RPC) throw new Error("RPC_URL required");
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"))));
  const conn = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync("./lib/idl/oracle.json", "utf8"));
  const oracle = new Program(idl, provider);
  const cfgPda = PublicKey.findProgramAddressSync([Buffer.from("config")], ORACLE)[0];
  const cfg: any = await oracle.account.config.fetch(cfgPda);
  if (!cfg.admin.equals(admin.publicKey)) {
    throw new Error(`Config.admin (${cfg.admin.toBase58()}) != signer (${admin.publicKey.toBase58()})`);
  }
  console.log("admin OK:", admin.publicKey.toBase58());

  // 1. expand_constituents_to_50 (realloc registry + index_state)
  console.log("\n[1] expand_constituents_to_50 (realloc)...");
  const expandSig = await oracle.methods.expandConstituentsTo50().accounts({ admin: admin.publicKey } as never).rpc();
  console.log("    tx:", expandSig);

  // 2. update_constituent for slots 25..49
  console.log("\n[2] populating slots 25..49 with PMT26-50 list...");
  for (let i = 0; i < NEW_25.length; i++) {
    const idx = 25 + i;
    const s = NEW_25[i];
    const sig = await oracle.methods
      .updateConstituent(idx, {
        basePrice: new BN(s.price * 1_000_000),
        canonicalSearchHash: Array.from(Buffer.alloc(32)),
        setCode: fixedBytes(s.set, 8),
        variantCode: fixedBytes(s.variant, 8),
        collectorNumber: s.num,
        setTotal: s.total,
      })
      .accounts({ admin: admin.publicKey } as never)
      .rpc();
    console.log(`    slot ${idx.toString().padStart(2)} = ${s.name.padEnd(28)} ${sig.slice(0, 12)}…`);
  }

  // 3. finalize_registry_update
  const today = Math.floor(Date.now() / 86_400_000);
  console.log(`\n[3] finalize_registry_update day=${today}...`);
  const finalSig = await oracle.methods.finalizeRegistryUpdate(today).accounts({ admin: admin.publicKey } as never).rpc();
  console.log("    tx:", finalSig);

  // 4. Verify on-chain state
  const regAcc = await conn.getAccountInfo(PublicKey.findProgramAddressSync([Buffer.from("registry")], ORACLE)[0]);
  const idxAcc = await conn.getAccountInfo(PublicKey.findProgramAddressSync([Buffer.from("index_state")], ORACLE)[0]);
  console.log("\n=== POST-MIGRATION STATE ===");
  console.log("registry account size: ", regAcc?.data.length, "bytes (expected ~3224 for N=50)");
  console.log("index_state account size:", idxAcc?.data.length, "bytes (expected ~473 for N=50)");
}

main().catch((e) => { console.error(e); process.exit(1); });
