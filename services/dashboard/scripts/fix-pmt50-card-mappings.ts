/**
 * Fix the on-chain (set_code, collector_number, variant_code) tuples for
 * PMT26-50 slots whose original entries pointed at the wrong pokemontcg.io
 * card. The scrape that drove the original list used eBay listing numbering
 * which doesn't always match pokemontcg.io's catalog numbers.
 *
 * Cross-verified each fix below against `api.pokemontcg.io/v2/cards/<id>` —
 * the destination ID corresponds to the right card name + rarity.
 *
 * Still broken after this script (need user-driven substitutes — these cards
 * are not in pokemontcg.io's catalog under the (set, num) we picked, and
 * "Charizard VSTAR / Pikachu VMAX / Rayquaza VMAX / Zacian V" don't exist in
 * the Crown Zenith Galarian Gallery subset at all):
 *   - slot 33: CEL-25-UN Pikachu V-UNION
 *   - slot 34: CZ-29-GG Charizard VSTAR
 *   - slot 35: CZ-44-GG Pikachu VMAX
 *   - slot 36: CZ-50-GG Rayquaza VMAX
 *   - slot 37: CZ-51-GG Zacian V
 *   - slot 42: SC-232-SAR Lance's Charizard ex (newer card, not yet indexed)
 *
 * Run (mainnet, signed by deploy keypair):
 *   cd services/dashboard
 *   RPC_URL="<mainnet>" WALLET_PATH=/d/pokeperp/mainnet-keys/deploy.json \
 *   npx tsx scripts/fix-pmt50-card-mappings.ts
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

// Verified-correct entries per pokemontcg.io.  `base_price` preserved from the
// original PMT26-50 list (those values were eBay $-volume estimates, independent
// of the catalog number issue).
type Fix = {
  slot: number;
  name: string;
  set: string;
  num: number;
  variant: string;
  total: number;
  price: number;
  note?: string;
};

const FIXES: Fix[] = [
  // slot 26: PMK-193-SIR was the Mew ex SIR (Pikachu ex SIR doesn't exist in 151).
  //   Point this slot at the famous Pikachu (151) Illustration Rare instead — closest
  //   real Pikachu in the set. Keeping variant "SIR" for the badge; the cards.ts
  //   CARD_NAMES entry will be updated to "Pikachu (151)".
  { slot: 26, name: "Pikachu (151)",      set: "PMK", num: 173, variant: "SIR", total: 165, price: 899,
    note: "no Pikachu ex SIR in sv3pt5; sv3pt5-173 is the well-known Pikachu IR" },

  // slot 30: PMK-205-SIR (Mew ex Hyper Rare) → PMK-193-SIR (real Mew ex SIR).
  { slot: 30, name: "Mew ex (151)",       set: "PMK", num: 193, variant: "SIR", total: 165, price: 360 },

  // slot 31: LO-213-AA was Hisuian Zoroark VSTAR. Real Giratina VSTAR alt-art is swsh11-212.
  { slot: 31, name: "Giratina VSTAR",     set: "LO",  num: 212, variant: "AA",  total: 196, price: 650 },

  // slot 38: AR-211 was "Choice Belt". Real Origin Palkia VSTAR alt-art is swsh10-208.
  { slot: 38, name: "Origin Forme Palkia VSTAR", set: "AR", num: 208, variant: "AA", total: 189, price: 250 },

  // slot 39: AR-209 was Hisuian Samurott VSTAR. Real Origin Dialga VSTAR alt-art is swsh10-210.
  { slot: 39, name: "Origin Forme Dialga VSTAR", set: "AR", num: 210, variant: "AA", total: 189, price: 183 },

  // slot 40: AR-205 was Kamado. Hisuian Goodra V alt-art is actually in Lost Origin
  //   (swsh11-187), NOT Astral Radiance. Cross-set move: AR → LO.
  { slot: 40, name: "Hisuian Goodra V",   set: "LO",  num: 187, variant: "AA",  total: 196, price: 175 },

  // slot 45: PaF-91 was Ultra Ball. Real Penny SAR is sv4pt5-239.
  { slot: 45, name: "Penny",              set: "PaF", num: 239, variant: "SAR", total: 91,  price: 125 },

  // slot 46: TM-167 was Legacy Energy. Hydreigon ex SIR is actually in Surging Sparks
  //   (sv8-240), NOT Twilight Masquerade. Cross-set move: TM → SS.
  { slot: 46, name: "Hydreigon ex",       set: "SS",  num: 240, variant: "SIR", total: 191, price: 126 },

  // slot 47: PR-191 was Wimpod. Real Mela SAR is sv4-254.
  { slot: 47, name: "Mela",               set: "PR",  num: 254, variant: "SAR", total: 182, price: 120 },

  // slot 48: PaE-270 was Saguaro. Real Boss's Orders (Ghetsis) SIR is sv2-265.
  { slot: 48, name: "Boss's Orders (Ghetsis)", set: "PaE", num: 265, variant: "SAR", total: 193, price: 71 },

  // slot 49: OF-226 was Geeta SIR. Tyranitar ex doesn't have an SIR variant in
  //   Obsidian Flames — the chase is the Ultra Rare alt-art at sv3-211. Change
  //   variant from SIR to AA.
  { slot: 49, name: "Tyranitar ex",       set: "OF",  num: 211, variant: "AA",  total: 197, price: 70 },
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
  console.log(`applying ${FIXES.length} slot corrections...`);

  for (const f of FIXES) {
    const sig = await oracle.methods
      .updateConstituent(f.slot, {
        basePrice: new BN(f.price * 1_000_000),
        canonicalSearchHash: Array.from(Buffer.alloc(32)),
        setCode: fixedBytes(f.set, 8),
        variantCode: fixedBytes(f.variant, 8),
        collectorNumber: f.num,
        setTotal: f.total,
      })
      .accounts({ admin: admin.publicKey } as never)
      .rpc();
    console.log(`  slot ${String(f.slot).padStart(2)} → ${f.set}-${f.num}-${f.variant} (${f.name.padEnd(30)}) ${sig.slice(0, 12)}…`);
  }

  const today = Math.floor(Date.now() / 86_400_000);
  console.log(`\nfinalize_registry_update(day=${today})...`);
  const finalSig = await oracle.methods.finalizeRegistryUpdate(today).accounts({ admin: admin.publicKey } as never).rpc();
  console.log(`  tx: ${finalSig}`);

  console.log("\n=== Done. ===");
  console.log("Still need user input for these 6 slots (cards not in pokemontcg.io catalog):");
  console.log("  slot 33: CEL-25-UN Pikachu V-UNION       (V-UNION only in swshp promos)");
  console.log("  slot 34: CZ-29-GG  Charizard VSTAR        (not in CZ Galarian Gallery)");
  console.log("  slot 35: CZ-44-GG  Pikachu VMAX           (not in CZ Galarian Gallery)");
  console.log("  slot 36: CZ-50-GG  Rayquaza VMAX          (not in CZ Galarian Gallery)");
  console.log("  slot 37: CZ-51-GG  Zacian V               (not in CZ Galarian Gallery)");
  console.log("  slot 42: SC-232-SAR Lance's Charizard ex  (newer card not yet indexed)");
}

main().catch((e) => { console.error(e); process.exit(1); });
