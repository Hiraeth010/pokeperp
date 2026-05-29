/**
 * Update individual risk params on the mainnet market via the v0.9
 * `update_risk_params` instruction, signed by the admin key. Unlike set_phase,
 * this changes ONLY the fields you pass — it does NOT move phase bundles.
 *
 * Default target: 5× leverage (IM 2000 / MM 1000) while KEEPING the market's
 * current OI/position caps, funding cap, and slippage (read live, passed back
 * unchanged). Override IM/MM via env if needed.
 *
 * Preview (safe, default): RPC_URL="<mainnet>" npx tsx scripts/set-risk-params-mainnet.ts
 * Fire it:                 ... BROADCAST=true WALLET_PATH="../../mainnet-keys/deploy.json" ...
 */
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "node:fs";
import PerpIdl from "../lib/idl/perp_engine.json";
import type { PerpEngine } from "../lib/idl/perp_engine";
import { resolveRpc } from "./rpc";

const RPC = resolveRpc();
const WALLET_PATH = process.env.WALLET_PATH ?? "../../mainnet-keys/deploy.json";
const BROADCAST = (process.env.BROADCAST ?? "false") === "true";
const IM_BPS = Number(process.env.INITIAL_MARGIN_BPS ?? "2000"); // 2000 = 5×
const MM_BPS = Number(process.env.MAINTENANCE_MARGIN_BPS ?? "1000"); // 10%

const kp = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
const usd = (x: { toString(): string }) => "$" + (Number(x.toString()) / 1e6).toLocaleString();

async function main(): Promise<void> {
  if (!RPC.includes("mainnet")) throw new Error(`Refusing: RPC not mainnet (${RPC})`);
  if (!(IM_BPS > MM_BPS && MM_BPS > 0)) throw new Error(`Bad margins: IM ${IM_BPS} must be > MM ${MM_BPS} > 0`);

  const admin = kp(WALLET_PATH);
  const conn = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(admin), { commitment: "confirmed" });
  const perp = new Program<PerpEngine>(PerpIdl as unknown as PerpEngine, provider);
  const marketPda = PublicKey.findProgramAddressSync([Buffer.from("market")], perp.programId)[0];

  const m = await perp.account.market.fetch(marketPda);
  // KEEP these unchanged — read live and pass back.
  const params = {
    initialMarginBps: IM_BPS,
    maintenanceMarginBps: MM_BPS,
    maxOiPerSide: m.maxOiPerSide as BN,
    maxPositionPerTrader: m.maxPositionPerTrader as BN,
    fundingCapPerHourBps: Number(m.fundingCapPerHourBps),
    slippageFactor: Number(m.slippageFactor),
  };

  console.log("=== update_risk_params preview ===");
  console.log("admin (signer):", admin.publicKey.toBase58(), admin.publicKey.equals(m.admin) ? "✓" : "✗ NOT market.admin!");
  console.log("phase (unchanged):", m.phase);
  console.log(`leverage:  ${m.initialMarginBps} bps (${(10000 / Number(m.initialMarginBps)).toFixed(2)}×)  →  ${IM_BPS} bps (${(10000 / IM_BPS).toFixed(2)}×)`);
  console.log(`maint.margin: ${m.maintenanceMarginBps} → ${MM_BPS} bps`);
  console.log("KEEP max_oi_per_side:", usd(m.maxOiPerSide), "| max_position_per_trader:", usd(m.maxPositionPerTrader));
  console.log("KEEP funding_cap_per_hour_bps:", Number(m.fundingCapPerHourBps), "| slippage_factor:", Number(m.slippageFactor));

  if (!admin.publicKey.equals(m.admin)) throw new Error("Signer is not market admin — would fail.");

  const builder = perp.methods.updateRiskParams(params as never).accounts({ market: marketPda, admin: admin.publicKey } as never);
  const simErr = await builder.simulate().then(() => null).catch((e) => e);
  if (simErr) {
    console.log("\n✗ SIMULATION FAILED:");
    console.log(String(simErr?.message ?? simErr).split("\n").slice(0, 8).join("\n"));
    process.exit(1);
  }
  console.log("\n✓ simulation OK — tx valid.");

  if (!BROADCAST) {
    console.log("\nDRY RUN — nothing sent. Re-run with BROADCAST=true to fire.");
    return;
  }
  console.log("\n--- broadcasting update_risk_params ---");
  const sig = await builder.rpc();
  const after = await perp.account.market.fetch(marketPda);
  console.log(`✓ IM ${after.initialMarginBps} (${(10000 / Number(after.initialMarginBps)).toFixed(2)}× max lev) | MM ${after.maintenanceMarginBps} | phase ${after.phase} | OI cap ${usd(after.maxOiPerSide)} | per-trader ${usd(after.maxPositionPerTrader)}`);
  console.log("tx:", sig);
}

main().catch((e) => { console.error(e); process.exit(1); });
