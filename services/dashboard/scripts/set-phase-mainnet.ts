/**
 * Advance the mainnet market phase (risk profile), signed by the admin key.
 * Works while Market.admin is the deploy wallet (BEFORE the Squad migration);
 * once admin is the Squad, route set_phase through the multisig instead.
 *
 * `set_phase(n)` writes a BUNDLED risk profile (see programs/perp-engine/src/lib.rs
 * §set_phase) — not just leverage:
 *   Phase 1: 3× lev (33% IM / 16.5% MM), 50k/trader, 500k OI/side, 0.10%/hr funding.
 *   Phase 2: 5× lev (20% IM / 10%   MM), 250k/trader, 5M  OI/side, 0.50%/hr funding.
 *   Phase 0 (shadow) / Phase 3 (orderbook v2) leave Market params unchanged.
 *
 * SAFETY: dry-run by default. It simulates the tx but does NOT send unless you
 * pass BROADCAST=true. For PHASE>=2 it also refuses to broadcast while the
 * insurance vault is below INSURANCE_MIN_USDC (default 250000, per the
 * mainnet-runbook Phase-2 gate) unless FORCE=true.
 *
 * Preview (safe):
 *   RPC_URL="<mainnet>" PHASE=2 npx tsx scripts/set-phase-mainnet.ts
 * Fire it (after insurance is funded):
 *   RPC_URL="<mainnet>" PHASE=2 BROADCAST=true \
 *     WALLET_PATH="../../mainnet-keys/deploy.json" npx tsx scripts/set-phase-mainnet.ts
 */
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "node:fs";
import PerpIdl from "../lib/idl/perp_engine.json";
import type { PerpEngine } from "../lib/idl/perp_engine";
import { resolveRpc } from "./rpc";

const RPC = resolveRpc();
const WALLET_PATH = process.env.WALLET_PATH ?? "../../mainnet-keys/deploy.json";
const PHASE = Number(process.env.PHASE ?? "");
const BROADCAST = (process.env.BROADCAST ?? "false") === "true";
const FORCE = (process.env.FORCE ?? "false") === "true";
const INSURANCE_MIN_USDC = Number(process.env.INSURANCE_MIN_USDC ?? "250000");

const kp = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
const usd = (x: { toString(): string }) => "$" + (Number(x.toString()) / 1e6).toLocaleString();

// Mirrors programs/perp-engine/src/lib.rs set_phase() for human-readable preview.
const PHASE_PROFILE: Record<number, string> = {
  0: "shadow — Market params UNCHANGED",
  1: "3.03× lev (IM 3300 / MM 1650), 50k/trader, 500k OI/side, 0.10%/hr, slip 0.10",
  2: "5× lev (IM 2000 / MM 1000), 250k/trader, 5M OI/side, 0.50%/hr, slip 0.05",
  3: "orderbook v2 — Market params UNCHANGED",
};

async function main(): Promise<void> {
  if (!RPC.includes("mainnet")) throw new Error(`Refusing: RPC not mainnet (${RPC})`);
  if (!Number.isInteger(PHASE) || PHASE < 0 || PHASE > 3) {
    throw new Error(`Set PHASE to 0–3 (got "${process.env.PHASE}")`);
  }

  const admin = kp(WALLET_PATH);
  const conn = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: "confirmed" });
  const perp = new Program<PerpEngine>(PerpIdl as unknown as PerpEngine, provider);
  const marketPda = PublicKey.findProgramAddressSync([Buffer.from("market")], perp.programId)[0];
  const insVault = PublicKey.findProgramAddressSync([Buffer.from("insurance_vault")], perp.programId)[0];

  const mkt = await perp.account.market.fetch(marketPda);
  const insBal = await conn.getTokenAccountBalance(insVault).then((r) => Number(r.value.amount) / 1e6).catch(() => 0);

  console.log("=== set_phase preview ===");
  console.log("admin (signer):   ", admin.publicKey.toBase58(), admin.publicKey.equals(mkt.admin) ? "✓ matches market.admin" : "✗ NOT market.admin!");
  console.log("current phase:    ", mkt.phase, "→", PHASE_PROFILE[mkt.phase as number]);
  console.log("  initial_margin_bps:", mkt.initialMarginBps, "| maintenance_margin_bps:", mkt.maintenanceMarginBps);
  console.log("  max_oi_per_side:", usd(mkt.maxOiPerSide), "| max_position_per_trader:", usd(mkt.maxPositionPerTrader));
  console.log("  long_oi/short_oi:", usd(mkt.longOi ?? 0), "/", usd(mkt.shortOi ?? 0));
  console.log("TARGET phase:     ", PHASE, "→", PHASE_PROFILE[PHASE]);
  console.log("insurance_vault:  ", usd((insBal * 1e6).toString()), `(${insVault.toBase58()})`);

  if (!admin.publicKey.equals(mkt.admin)) {
    throw new Error("Signer is not the market admin — would fail on-chain. (Admin may have moved to the Squad.)");
  }

  // Phase-2+ insurance gate.
  if (PHASE >= 2 && insBal < INSURANCE_MIN_USDC) {
    const gap = INSURANCE_MIN_USDC - insBal;
    const msg = `Insurance $${insBal.toLocaleString()} < Phase-${PHASE} floor $${INSURANCE_MIN_USDC.toLocaleString()} (gap $${gap.toLocaleString()})`;
    if (!FORCE) {
      console.log(`\n⛔ BLOCKED: ${msg}.\n   Fund insurance first, or override with FORCE=true (NOT recommended).`);
      process.exit(1);
    }
    console.log(`\n⚠️  ${msg} — proceeding anyway because FORCE=true.`);
  }

  // Build + simulate (validates it would succeed regardless of broadcast).
  const builder = perp.methods.setPhase(PHASE).accounts({ market: marketPda, admin: admin.publicKey } as never);
  const sim = await builder.simulate().then(() => null).catch((e) => e);
  if (sim) {
    console.log("\n✗ SIMULATION FAILED — would not succeed on-chain:");
    console.log(String(sim?.message ?? sim).split("\n").slice(0, 8).join("\n"));
    process.exit(1);
  }
  console.log("\n✓ simulation OK — tx is valid and ready.");

  if (!BROADCAST) {
    console.log("\nDRY RUN — nothing sent. Re-run with BROADCAST=true to fire.");
    return;
  }

  console.log("\n--- broadcasting set_phase(", PHASE, ") ---");
  const sig = await builder.rpc();
  const after = await perp.account.market.fetch(marketPda);
  console.log(`✓ phase is now ${after.phase} | IM ${after.initialMarginBps} (${(10000 / Number(after.initialMarginBps)).toFixed(2)}× max lev) | MM ${after.maintenanceMarginBps}`);
  console.log("  max_oi_per_side:", usd(after.maxOiPerSide), "| max_position_per_trader:", usd(after.maxPositionPerTrader));
  console.log("tx:", sig);
}

main().catch((e) => { console.error(e); process.exit(1); });
