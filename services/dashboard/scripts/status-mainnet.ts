/**
 * Read-only mainnet status snapshot. Safe to run anytime.
 *   RPC_URL="<mainnet>" npx tsx scripts/status-mainnet.ts
 */
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import OracleIdl from "../lib/idl/oracle.json";
import PerpIdl from "../lib/idl/perp_engine.json";
import type { Oracle } from "../lib/idl/oracle";
import type { PerpEngine } from "../lib/idl/perp_engine";
import { resolveRpc } from "./rpc";

const RPC = resolveRpc();
const usd = (x: { toString(): string }) => "$" + (Number(x.toString()) / 1e6).toLocaleString();

async function main(): Promise<void> {
  const conn = new Connection(RPC, "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(Keypair.generate()), { commitment: "confirmed" });
  const oracle = new Program<Oracle>(OracleIdl as unknown as Oracle, provider);
  const perp = new Program<PerpEngine>(PerpIdl as unknown as PerpEngine, provider);
  const pda = (s: string, pid: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from(s)], pid)[0];

  const cfg = await oracle.account.config.fetch(pda("config", oracle.programId));
  const mkt = await perp.account.market.fetch(pda("market", perp.programId));

  console.log("RPC:", RPC.replace(/api-key=[^&]+/, "api-key=***"));
  console.log("\n=== ORACLE Config ===");
  console.log("  admin:           ", cfg.admin.toBase58());
  console.log("  publisher_bond:  ", usd(cfg.publisherBond));
  console.log("  min_publishers:  ", cfg.minPublishersPerDay);
  console.log("  submission_window:", `${cfg.submissionWindowStart}–${cfg.submissionWindowEnd}s UTC`);

  console.log("\n=== PERP Market ===");
  console.log("  admin:           ", mkt.admin.toBase58());
  console.log("  trading_paused:  ", mkt.tradingPaused, mkt.tradingPaused ? "🔒 (trading disabled)" : "🟢 (trading OPEN)");
  console.log("  funding_paused:  ", mkt.fundingPaused);
  console.log("  phase:           ", mkt.phase);
  console.log("  long_oi/short_oi:", usd(mkt.longOi ?? 0), "/", usd(mkt.shortOi ?? 0));

  try {
    const idx = await oracle.account.indexState.fetch(pda("index_state", oracle.programId));
    const cs = idx.constituentStatus as number[];
    const fresh = cs.filter((s) => s === 0).length;
    console.log("\n=== Oracle IndexState ===");
    console.log("  day:             ", idx.day);
    console.log("  status:          ", Object.keys(idx.status as object)[0]);
    console.log("  index_value:     ", "$" + (Number(idx.indexValue.toString()) / 1e6).toLocaleString());
    console.log("  constituents:    ", `${fresh}/25 fresh, ${25 - fresh} stale/fallback`);
  } catch {
    console.log("\n=== Oracle IndexState ===\n  (not created yet)");
  }

  const insVault = pda("insurance_vault", perp.programId);
  const treVault = pda("treasury_vault", perp.programId);
  const bal = async (p: PublicKey) => {
    try { return usd((await conn.getTokenAccountBalance(p)).value.amount); } catch { return "(no account)"; }
  };
  console.log("\n=== Vaults ===");
  console.log("  insurance_vault: ", await bal(insVault), `(${insVault.toBase58()})`);
  console.log("  treasury_vault:  ", await bal(treVault), `(${treVault.toBase58()})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
