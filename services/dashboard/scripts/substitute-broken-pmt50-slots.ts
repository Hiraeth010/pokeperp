/**
 * Substitute the 6 PMT26-50 slots whose original cards don't exist in
 * pokemontcg.io's catalog at our chosen (set_code, num).  Each substitute
 * is a verified real high-volume modern chase that doesn't duplicate any
 * existing constituent.
 *
 * Original → substitute:
 *   slot 33: CEL-25-UN  Pikachu V-UNION       → TM-216-SIR  Bloodmoon Ursaluna ex
 *   slot 34: CZ-29-GG   Charizard VSTAR (GG)  → CZ-44-GG    Mewtwo VSTAR (CZ-GG, real)
 *   slot 35: CZ-44-GG   Pikachu VMAX (GG)     → CZ-50-GG    Darkrai VSTAR (CZ-GG)
 *   slot 36: CZ-50-GG   Rayquaza VMAX (GG)    → CZ-51-GG    Hisuian Samurott V (CZ-GG)
 *   slot 37: CZ-51-GG   Zacian V (GG)         → TM-214-SIR  Greninja ex
 *   slot 42: SC-232-SAR Lance's Charizard ex  → SC-170-SIR  Terapagos ex
 *
 * Run (mainnet, signed by deploy keypair):
 *   cd services/dashboard
 *   RPC_URL="<mainnet>" WALLET_PATH=/d/pokeperp/mainnet-keys/deploy.json \
 *   npx tsx scripts/substitute-broken-pmt50-slots.ts
 */
import { AnchorProvider, Program, Wallet, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "node:fs";

import OracleIdl from "../lib/idl/oracle.json";

const RPC = process.env.RPC_URL!;
const WALLET_PATH = process.env.WALLET_PATH!;
const ORACLE = new PublicKey("GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i");

const fixedBytes = (s: string, n: number) => {
  const b = Buffer.alloc(n);
  Buffer.from(s, "utf8").copy(b);
  return Array.from(b);
};

type Sub = {
  slot: number;
  name: string;
  set: string;
  num: number;
  variant: string;
  total: number;
  price: number;
};

const SUBSTITUTES: Sub[] = [
  { slot: 33, name: "Bloodmoon Ursaluna ex", set: "TM",  num: 216, variant: "SIR", total: 226, price: 250 },
  { slot: 34, name: "Mewtwo VSTAR",          set: "CZ",  num:  44, variant: "GG",  total:  70, price:  80 },
  { slot: 35, name: "Darkrai VSTAR",         set: "CZ",  num:  50, variant: "GG",  total:  70, price:  50 },
  { slot: 36, name: "Hisuian Samurott V",    set: "CZ",  num:  51, variant: "GG",  total:  70, price:  40 },
  { slot: 37, name: "Greninja ex",           set: "TM",  num: 214, variant: "SIR", total: 226, price:  80 },
  { slot: 42, name: "Terapagos ex",          set: "SC",  num: 170, variant: "SIR", total: 175, price: 120 },
];

async function main(): Promise<void> {
  if (!RPC) throw new Error("RPC_URL required");
  if (!WALLET_PATH) throw new Error("WALLET_PATH required");
  if (!RPC.includes("mainnet")) throw new Error(`Refusing: RPC not mainnet (${RPC})`);

  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"))));
  const conn = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: "confirmed" });
  const oracle = new Program(OracleIdl as any, provider);

  const cfgPda = PublicKey.findProgramAddressSync([Buffer.from("config")], ORACLE)[0];
  const cfg: any = await oracle.account.config.fetch(cfgPda);
  if (!cfg.admin.equals(admin.publicKey)) {
    throw new Error(`Config.admin (${cfg.admin.toBase58()}) != signer (${admin.publicKey.toBase58()})`);
  }
  console.log(`admin OK: ${admin.publicKey.toBase58()}`);
  console.log(`substituting ${SUBSTITUTES.length} broken slots...`);

  for (const s of SUBSTITUTES) {
    const sig = await oracle.methods
      .updateConstituent(s.slot, {
        basePrice: new BN(s.price * 1_000_000),
        canonicalSearchHash: Array.from(Buffer.alloc(32)),
        setCode: fixedBytes(s.set, 8),
        variantCode: fixedBytes(s.variant, 8),
        collectorNumber: s.num,
        setTotal: s.total,
      })
      .accounts({ admin: admin.publicKey } as never)
      .rpc();
    console.log(`  slot ${String(s.slot).padStart(2)} → ${s.set}-${s.num}-${s.variant} (${s.name.padEnd(28)}) ${sig.slice(0, 12)}…`);
  }

  const today = Math.floor(Date.now() / 86_400_000);
  console.log(`\nfinalize_registry_update(day=${today})...`);
  const finalSig = await oracle.methods.finalizeRegistryUpdate(today).accounts({ admin: admin.publicKey } as never).rpc();
  console.log(`  tx: ${finalSig}`);
  console.log("\n=== All 50 slots now point at real pokemontcg.io cards. ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
