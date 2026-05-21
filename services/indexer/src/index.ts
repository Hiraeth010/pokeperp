/**
 * Pokeperp indexer.
 *
 * Subscribes to the local validator's IndexState + Market accounts, polls for
 * position closures, and appends JSONL records to data/*.jsonl. The dashboard
 * reads from those files via Next.js API routes — no shared DB, no extra moving
 * parts.
 *
 * Run with:
 *   cd services/indexer
 *   npm install
 *   npm run dev
 */

import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

import OracleIdl from "../../dashboard/lib/idl/oracle.json" with { type: "json" };
import PerpIdl from "../../dashboard/lib/idl/perp_engine.json" with { type: "json" };
import type { Oracle } from "../../dashboard/lib/idl/oracle.ts";
import type { PerpEngine } from "../../dashboard/lib/idl/perp_engine.ts";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const RPC_HTTP = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const RPC_WS = process.env.RPC_WS ?? "ws://127.0.0.1:8900";
const POSITION_POLL_MS = Number(process.env.POSITION_POLL_MS ?? "5000");

const ORACLE_ID = new PublicKey(
  "GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i"
);
const PERP_ID = new PublicKey("Gtpv6K9Fi3pkYcYZEzqaS8DW2nqDwpwPf24Q1WxsQzsa");

function pda(seeds: Buffer[], program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, program)[0];
}

const INDEX_STATE_PDA = pda([Buffer.from("index_state")], ORACLE_ID);
const MARKET_PDA = pda([Buffer.from("market")], PERP_ID);

/** Append a JSON object as a single line (JSONL) to the named file. */
function appendJsonl(name: string, record: Record<string, unknown>): void {
  fs.appendFileSync(path.join(DATA_DIR, name), JSON.stringify(record) + "\n");
}

/** Convert BN/PublicKey-bearing values to JSON-serializable primitives. */
function clean(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "object") {
    if ("toBase58" in v && typeof v.toBase58 === "function") {
      return (v as { toBase58: () => string }).toBase58();
    }
    if ("toString" in v && v.constructor?.name === "BN") {
      return (v as { toString: () => string }).toString();
    }
    if (Array.isArray(v)) return v.map(clean);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = clean((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

async function main(): Promise<void> {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // Anchor needs a wallet on the provider even for read-only operations.
  const readOnlyWallet = new Wallet(Keypair.generate());
  const connection = new Connection(RPC_HTTP, {
    wsEndpoint: RPC_WS,
    commitment: "confirmed",
  });
  const provider = new AnchorProvider(connection, readOnlyWallet, {
    commitment: "confirmed",
  });
  const oracle = new Program<Oracle>(OracleIdl as unknown as Oracle, provider);
  const perp = new Program<PerpEngine>(
    PerpIdl as unknown as PerpEngine,
    provider
  );

  console.log(`Pokeperp indexer`);
  console.log(`  RPC:          ${RPC_HTTP}`);
  console.log(`  WS:           ${RPC_WS}`);
  console.log(`  Data dir:     ${DATA_DIR}`);
  console.log(`  IndexState:   ${INDEX_STATE_PDA.toBase58()}`);
  console.log(`  Market:       ${MARKET_PDA.toBase58()}`);

  // ----- Initial fetches: capture current state at startup -----
  try {
    const ix = await oracle.account.indexState.fetchNullable(INDEX_STATE_PDA);
    if (ix) {
      const c = clean(ix) as Record<string, unknown>;
      appendJsonl("index.jsonl", { ts: Date.now(), ...c });
      console.log(`  initial IndexState: day=${c.day} value=${c.indexValue}`);
    }
    const mk = await perp.account.market.fetchNullable(MARKET_PDA);
    if (mk) {
      const c = clean(mk) as Record<string, unknown>;
      appendJsonl("market.jsonl", {
        ts: Date.now(),
        longOi: c.longOi,
        shortOi: c.shortOi,
        markTwap1H: c.markTwap1H,
        markTwap5Min: c.markTwap5Min,
        cumulativeFundingLong: c.cumulativeFundingLong,
        lastFundingUpdate: c.lastFundingUpdate,
        tradingPaused: c.tradingPaused,
      });
      console.log(`  initial Market:     longOi=${c.longOi}`);
    }
  } catch (e) {
    console.error("initial fetch failed:", e);
  }

  // ----- IndexState subscription -----
  // IndexState is owned by the oracle program; use oracle's decoder.
  connection.onAccountChange(
    INDEX_STATE_PDA,
    (info) => {
      try {
        const decoded = oracle.coder.accounts.decode("indexState", info.data);
        const c = clean(decoded) as Record<string, unknown>;
        const rec = { ts: Date.now(), ...c };
        appendJsonl("index.jsonl", rec);
        process.stdout.write(`[index] day=${c.day} value=${c.indexValue}\n`);
      } catch (e) {
        console.error("decode IndexState failed:", e);
      }
    },
    "confirmed"
  );

  // ----- Market subscription -----
  connection.onAccountChange(
    MARKET_PDA,
    (info) => {
      try {
        const decoded = perp.coder.accounts.decode("market", info.data);
        const c = clean(decoded) as Record<string, unknown>;
        const rec = {
          ts: Date.now(),
          longOi: c.longOi,
          shortOi: c.shortOi,
          markTwap1H: c.markTwap1H,
          markTwap5Min: c.markTwap5Min,
          cumulativeFundingLong: c.cumulativeFundingLong,
          lastFundingUpdate: c.lastFundingUpdate,
          tradingPaused: c.tradingPaused,
        };
        appendJsonl("market.jsonl", rec);
        process.stdout.write(
          `[market] longOi=${rec.longOi} shortOi=${rec.shortOi}\n`
        );
      } catch (e) {
        console.error("decode Market failed:", e);
      }
    },
    "confirmed"
  );

  // ----- Position polling (for close detection) -----
  // No event emission in v0.1 so we poll for present positions; when one
  // disappears, we record a close event with the last-seen state.
  interface PosSnap {
    pubkey: string;
    trader: string;
    size: string;
    entryIndexPrice: string;
    entryMarkPrice: string;
    openedAt: string;
    seenAt: number;
  }
  const known = new Map<string, PosSnap>();

  async function pollPositions(): Promise<void> {
    try {
      const accounts = await perp.account.position.all();
      const current = new Set<string>();
      for (const a of accounts) {
        const key = a.publicKey.toBase58();
        current.add(key);
        const snap: PosSnap = {
          pubkey: key,
          trader: a.account.trader.toBase58(),
          size: a.account.size.toString(),
          entryIndexPrice: a.account.entryIndexPrice.toString(),
          entryMarkPrice: a.account.entryMarkPrice.toString(),
          openedAt: a.account.openedAt.toString(),
          seenAt: Date.now(),
        };
        const prior = known.get(key);
        if (!prior) {
          appendJsonl("opens.jsonl", { ts: Date.now(), kind: "open", ...snap });
          process.stdout.write(`[open] ${key.slice(0, 8)}… size=${snap.size}\n`);
        }
        known.set(key, snap);
      }
      // Detect closes
      for (const [key, last] of known) {
        if (!current.has(key)) {
          appendJsonl("closes.jsonl", {
            ts: Date.now(),
            kind: "close",
            ...last,
          });
          process.stdout.write(
            `[close] ${key.slice(0, 8)}… size=${last.size}\n`
          );
          known.delete(key);
        }
      }
    } catch (e) {
      console.error("position poll failed:", e);
    }
  }

  await pollPositions(); // initial sync
  setInterval(pollPositions, POSITION_POLL_MS);

  // Heartbeat
  console.log(`\nListening… (Ctrl+C to stop)`);
  process.on("SIGINT", () => {
    console.log("\nshutting down");
    process.exit(0);
  });

  // Keep the event loop alive forever
  setInterval(() => {}, 1 << 30);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
