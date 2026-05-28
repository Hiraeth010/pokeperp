/**
 * Pokeperp health monitor.
 *
 * Polls protocol *outcomes* (not just process liveness) and alerts via Telegram
 * on OK<->BAD transitions, so it catches both "service died" and "service
 * running but not doing its job":
 *
 *   oracle      — IndexState fresh? (publisher-crank health)
 *   funding     — Market.last_funding_update advancing? (keeper funding health)
 *   bad_debt    — any open position underwater past maintenance margin? (keeper
 *                 liquidation health) — equity math mirrors the on-chain liquidate
 *   insurance   — vault >= floor?
 *   indexer     — /health responding?
 *   keeper_sol  — keeper wallet has SOL to pay liquidation/funding txs?
 */
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import OracleIdl from "../idl/oracle.json" with { type: "json" };
import PerpIdl from "../idl/perp_engine.json" with { type: "json" };
import type { Oracle } from "../idl/oracle.ts";
import type { PerpEngine } from "../idl/perp_engine.ts";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? "120000");
const ORACLE_STALE_HOURS = Number(process.env.ORACLE_STALE_HOURS ?? "26");
const FUNDING_STALE_HOURS = Number(process.env.FUNDING_STALE_HOURS ?? "3");
const KEEPER_PUBKEY = process.env.KEEPER_PUBKEY ?? "AtLSGdhqYhqaVjt1zghHb9SZUEfPuMy2zXeqgX6L1EYw";
const KEEPER_MIN_SOL = Number(process.env.KEEPER_MIN_SOL ?? "0.05");
const INDEXER_HEALTH_URL =
  process.env.INDEXER_HEALTH_URL ?? "https://pokeperp-indexer-production.up.railway.app/health";

const ORACLE_ID = new PublicKey("GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i");
const PERP_ID = new PublicKey("Gtpv6K9Fi3pkYcYZEzqaS8DW2nqDwpwPf24Q1WxsQzsa");

const op = (s: string) => PublicKey.findProgramAddressSync([Buffer.from(s)], ORACLE_ID)[0];
const pp = (s: string) => PublicKey.findProgramAddressSync([Buffer.from(s)], PERP_ID)[0];
const big = (x: { toString(): string }) => BigInt(x.toString());
const usd = (micro: bigint) => "$" + (Number(micro) / 1e6).toLocaleString();

interface Check { name: string; ok: boolean; detail: string }

const conn = new Connection(RPC, "confirmed");
const provider = new AnchorProvider(conn, new Wallet(Keypair.generate()), { commitment: "confirmed" });
const oracle = new Program<Oracle>(OracleIdl as unknown as Oracle, provider);
const perp = new Program<PerpEngine>(PerpIdl as unknown as PerpEngine, provider);

async function telegram(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log("[alert:no-telegram]", text.replace(/\n/g, " "));
    return;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) console.error("telegram send failed", r.status, await r.text());
  } catch (e) {
    console.error("telegram error", e);
  }
}

async function runChecks(): Promise<Check[]> {
  const idx = await oracle.account.indexState.fetch(op("index_state"));
  const mkt = await perp.account.market.fetch(pp("market"));
  const nowS = Date.now() / 1000;
  const checks: Check[] = [];

  // oracle freshness
  const idxAgeH = (nowS - Number(idx.finalizedAt)) / 3600;
  checks.push({
    name: "oracle",
    ok: idxAgeH <= ORACLE_STALE_HOURS,
    detail: `index day ${Number(idx.day)} @ ${usd(big(idx.indexValue))}, updated ${idxAgeH.toFixed(1)}h ago (limit ${ORACLE_STALE_HOURS}h)`,
  });

  // funding freshness
  const fundAgeH = (nowS - Number(mkt.lastFundingUpdate)) / 3600;
  checks.push({
    name: "funding",
    ok: fundAgeH <= FUNDING_STALE_HOURS,
    detail: `last_funding_update ${fundAgeH.toFixed(1)}h ago (limit ${FUNDING_STALE_HOURS}h)`,
  });

  // insurance >= floor
  const fund = await perp.account.insuranceFund.fetch(pp("insurance_fund"));
  const vaultBal = BigInt((await conn.getTokenAccountBalance(pp("insurance_vault"))).value.amount);
  checks.push({
    name: "insurance",
    ok: vaultBal >= big(fund.floor),
    detail: `vault ${usd(vaultBal)} vs floor ${usd(big(fund.floor))}`,
  });

  // bad debt — only meaningful when the oracle is live (liquidations can run)
  const oracleLive = "provisional" in (idx.status as object) || "final" in (idx.status as object);
  if (!oracleLive) {
    checks.push({ name: "bad_debt", ok: true, detail: "skipped (oracle not live)" });
  } else {
    const indexPrice = big(idx.indexValue);
    const markTwap = big(mkt.markTwap5Min);
    const mmBps = big(mkt.maintenanceMarginBps);
    const cumFunding = big(mkt.cumulativeFundingLong);
    const positions = await perp.account.position.all();
    const underwater: string[] = [];
    for (const { account: p, publicKey } of positions) {
      const size = big(p.size);
      if (size === 0n) continue;
      const entryMark = big(p.entryMarkPrice);
      if (entryMark <= 0n) continue;
      const isLong = size > 0n;
      const liqRef = isLong
        ? markTwap > 0n && markTwap < indexPrice ? markTwap : indexPrice
        : markTwap > 0n && markTwap > indexPrice ? markTwap : indexPrice;
      const pricePnl = (size * (liqRef - entryMark)) / entryMark;
      const fundingOwed = (size * (cumFunding - big(p.cumulativeFundingSnapshot))) / 1_000_000n;
      const pnl = pricePnl - fundingOwed;
      let margin = 0n;
      try {
        margin = BigInt((await conn.getTokenAccountBalance(p.marginVault)).value.amount);
      } catch { /* vault gone */ }
      const equity = margin + pnl;
      const absSize = size < 0n ? -size : size;
      const mmThreshold = (absSize * mmBps) / 10_000n;
      if (equity < mmThreshold) underwater.push(publicKey.toBase58().slice(0, 8));
    }
    checks.push({
      name: "bad_debt",
      ok: underwater.length === 0,
      detail: underwater.length === 0
        ? `${positions.length} open position(s), none underwater`
        : `${underwater.length} underwater + unliquidated: ${underwater.join(", ")}`,
    });
  }

  // indexer /health
  try {
    const r = await fetch(INDEXER_HEALTH_URL, { signal: AbortSignal.timeout(10_000) });
    checks.push({ name: "indexer", ok: r.ok, detail: `${INDEXER_HEALTH_URL} → ${r.status}` });
  } catch (e) {
    checks.push({ name: "indexer", ok: false, detail: `unreachable: ${String(e)}` });
  }

  // keeper SOL
  const keeperSol = (await conn.getBalance(new PublicKey(KEEPER_PUBKEY))) / 1e9;
  checks.push({
    name: "keeper_sol",
    ok: keeperSol >= KEEPER_MIN_SOL,
    detail: `keeper ${keeperSol.toFixed(3)} SOL (min ${KEEPER_MIN_SOL})`,
  });

  return checks;
}

const lastStatus = new Map<string, boolean>();

async function cycle(): Promise<void> {
  let checks: Check[];
  try {
    checks = await runChecks();
  } catch (e) {
    console.error("check cycle error:", e);
    return; // transient RPC error — try again next tick, don't flip states
  }
  for (const c of checks) {
    const prev = lastStatus.get(c.name);
    if (prev !== undefined) {
      if (prev && !c.ok) await telegram(`🔴 <b>${c.name}</b> FAILED\n${c.detail}`);
      else if (!prev && c.ok) await telegram(`🟢 <b>${c.name}</b> recovered\n${c.detail}`);
    }
    lastStatus.set(c.name, c.ok);
  }
  console.log(checks.map((c) => `${c.ok ? "OK " : "BAD"} ${c.name}`).join(" | "));
}

async function main(): Promise<void> {
  console.log(`pokeperp monitor — RPC ${RPC.replace(/(api-key=)[^&]+/, "$1****")}, poll ${POLL_MS}ms, telegram ${BOT_TOKEN ? "on" : "OFF (logs only)"}`);
  // Baseline pass: set initial states without firing transition alerts, then
  // send one startup summary.
  let summary = "";
  try {
    const checks = await runChecks();
    for (const c of checks) lastStatus.set(c.name, c.ok);
    summary = checks.map((c) => `${c.ok ? "🟢" : "🔴"} ${c.name}: ${c.detail}`).join("\n");
    console.log(checks.map((c) => `${c.ok ? "OK " : "BAD"} ${c.name}`).join(" | "));
  } catch (e) {
    summary = `initial check failed: ${String(e)}`;
    console.error(e);
  }
  await telegram(`✅ <b>Pokeperp monitor started</b>\n${summary}`);

  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    await cycle();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
