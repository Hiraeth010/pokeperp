"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useWallet } from "@solana/wallet-adapter-react";

import { useMarket, usePositions } from "@/lib/perp";
import { useIndexState } from "@/lib/oracle";

/**
 * Mark vs Index chart — v0.9 upgrade.
 *
 * Three improvements over the v0.6 polling chart:
 *
 *   1. Spot-mark line.  TWAP is heavily EMA-smoothed (denom=16) so single
 *      trades barely move it.  We now also plot the spot mark — recomputed
 *      from each snapshot's (long_oi, short_oi, index, slippage_factor,
 *      oi_floor) using the same formula as the on-chain perp engine.  Traders
 *      see immediate impact; the TWAP line shows the funding-rate reference.
 *
 *   2. Live WebSocket updates.  Historical points still come from the indexer
 *      via /api/snapshots/*, but the 5s polling is gone.  After mount we
 *      subscribe to Market + IndexState via useMarket()/useIndexState() (which
 *      use Solana's onAccountChange under the hood) — chart updates within
 *      one confirmation slot of a trade landing.
 *
 *   3. Position annotation.  When a wallet is connected and holds a Position,
 *      two ReferenceLines mark the entry: a horizontal line at entry_mark_price
 *      and a vertical line at opened_at (mapped to the matching chart label).
 */

interface MarketPoint {
  ts: number;
  markTwap1H: string;
  longOi: string;
  shortOi: string;
}

interface IndexPoint {
  ts: number;
  indexValue: string;
  day: number;
}

interface ChartPoint {
  t: number;
  mark: number | null; // EMA-smoothed TWAP (the on-chain mark_twap_1h)
  spot: number | null; // Reconstructed spot mark from (index, long_oi, short_oi)
  index: number | null;
  label: string;
}

const E6 = 1_000_000;
const MAX_POINTS = 300; // cap memory / rendering work

/** Match the on-chain `compute_mark_price` math in perp-engine/lib.rs. */
function computeSpotMark(
  indexPriceMicro: bigint,
  longOiMicro: bigint,
  shortOiMicro: bigint,
  oiFloorMicro: bigint,
  slippageFactorE6: number,
): number {
  if (indexPriceMicro === 0n) return 0;
  const totalOi = longOiMicro + shortOiMicro;
  const denom = totalOi > oiFloorMicro ? totalOi : oiFloorMicro;
  if (denom === 0n) return Number(indexPriceMicro) / E6;
  const net = Number(longOiMicro - shortOiMicro);
  const imbalance = net / Number(denom);
  const indexUsd = Number(indexPriceMicro) / E6;
  return indexUsd * (1 + (slippageFactorE6 / E6) * imbalance);
}

export default function MarkVsIndexChart() {
  const [historical, setHistorical] = useState<ChartPoint[]>([]);
  const [live, setLive] = useState<ChartPoint[]>([]);

  // Live on-chain state via WebSocket subscriptions (no polling).
  const market = useMarket();
  const indexState = useIndexState();
  const { publicKey } = useWallet();
  const positions = usePositions(publicKey ?? null);

  // -------- Historical fetch (one-shot on mount) --------
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [markRes, idxRes] = await Promise.all([
          fetch("/api/snapshots/market?limit=300").then((r) => r.json()),
          fetch("/api/snapshots/index?limit=300").then((r) => r.json()),
        ]);
        if (cancelled) return;

        const mkt = markRes as MarketPoint[];
        const idx = idxRes as IndexPoint[];

        // Build unified timeline keyed on ts.
        const points = new Map<number, ChartPoint>();
        for (const m of mkt) {
          const markUsd = Number(m.markTwap1H) / E6;
          points.set(m.ts, {
            t: m.ts,
            mark: markUsd > 0 ? markUsd : null,
            spot: null, // filled in below after we know the index at this ts
            index: null,
            label: new Date(m.ts).toLocaleTimeString(),
          });
        }
        for (const i of idx) {
          const idxVal = Number(i.indexValue) / E6;
          const existing = points.get(i.ts);
          if (existing) {
            existing.index = idxVal;
          } else {
            points.set(i.ts, {
              t: i.ts,
              mark: null,
              spot: null,
              index: idxVal,
              label: new Date(i.ts).toLocaleTimeString(),
            });
          }
        }
        const sorted = [...points.values()].sort((a, b) => a.t - b.t);

        // Forward + backward fill the index so market-only points still have a value.
        let lastIndex: number | null = null;
        for (const p of sorted) {
          if (p.index !== null) lastIndex = p.index;
          else p.index = lastIndex;
        }
        let firstIndex: number | null = null;
        for (const p of sorted) {
          if (p.index !== null) {
            firstIndex = p.index;
            break;
          }
        }
        for (const p of sorted) {
          if (p.index === null && firstIndex !== null) p.index = firstIndex;
        }

        // Reconstruct spot mark for each market point using its long_oi/short_oi.
        // We need slippage_factor and oi_floor from the Market — those are fixed
        // config so we use the current live values (they don't change after init).
        // If the market hook hasn't loaded yet, leave spot=null and let the
        // recompute effect below patch it.
        if (market.status === "ready") {
          const { slippageFactor, oiFloor } = market.data;
          const marketByTs = new Map<number, MarketPoint>(
            mkt.map((m) => [m.ts, m] as [number, MarketPoint]),
          );
          for (const p of sorted) {
            const m = marketByTs.get(p.t);
            if (!m || p.index === null) continue;
            p.spot = computeSpotMark(
              BigInt(Math.round(p.index * E6)),
              BigInt(m.longOi),
              BigInt(m.shortOi),
              oiFloor,
              slippageFactor,
            );
          }
        }

        setHistorical(sorted.slice(-MAX_POINTS));
      } catch (e) {
        console.error("MarkVsIndexChart historical load failed", e);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // Run once on mount; live updates handle the rest.  We DO want to re-run if
    // `market.status` flips to "ready" after the historical fetch completed
    // first — that's when slippageFactor/oiFloor become known and we can
    // backfill the `spot` series on existing historical points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.status]);

  // -------- Live WebSocket updates --------
  useEffect(() => {
    if (market.status !== "ready" || indexState.status !== "ready") return;
    const m = market.data;
    const i = indexState.data;
    const ts = Date.now();
    const point: ChartPoint = {
      t: ts,
      mark: Number(m.markTwap1H) / E6 || null,
      spot: computeSpotMark(
        i.indexValue,
        m.longOi,
        m.shortOi,
        m.oiFloor,
        m.slippageFactor,
      ),
      index: Number(i.indexValue) / E6,
      label: new Date(ts).toLocaleTimeString(),
    };
    setLive((prev) => {
      // Cap at MAX_POINTS to avoid unbounded memory growth in a long session.
      const next = [...prev, point];
      return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
    });
    // useMarket / useIndexState return new object references on every account
    // change, so the dependency array fires once per on-chain update.
  }, [market, indexState]);

  // -------- Merge historical + live --------
  const data = useMemo(() => {
    if (live.length === 0) return historical;
    if (historical.length === 0) return live;
    // De-dupe by exact ts so a live point doesn't double-count a historical
    // point that landed at the same millisecond (rare but harmless to guard).
    const byTs = new Map<number, ChartPoint>();
    for (const p of historical) byTs.set(p.t, p);
    for (const p of live) byTs.set(p.t, p);
    const merged = [...byTs.values()].sort((a, b) => a.t - b.t);
    return merged.length > MAX_POINTS ? merged.slice(-MAX_POINTS) : merged;
  }, [historical, live]);

  // -------- User's active position (for the ReferenceLines) --------
  const userPosition =
    positions.status === "ready" && positions.data.length > 0
      ? positions.data[0]
      : null;

  // Map the position's opened_at (Unix seconds) onto the closest chart label so
  // the vertical ReferenceLine actually has an x to bind to.  Recharts'
  // category x-axis means we need a matching `label` string, not a raw time.
  const positionOpenLabel = useMemo(() => {
    if (!userPosition || data.length === 0) return null;
    const openedTs = userPosition.openedAt * 1000;
    let bestLabel: string | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const p of data) {
      const delta = Math.abs(p.t - openedTs);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestLabel = p.label;
      }
    }
    // Only annotate if the position was opened within the visible window
    // (within 5 minutes of any rendered point).  Otherwise the marker would
    // sit at the chart edge and confuse more than it helps.
    return bestDelta <= 5 * 60 * 1000 ? bestLabel : null;
  }, [userPosition, data]);

  if (data.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-[rgb(var(--muted))]">
          Waiting for indexer data… open a position or aggregate a day to
          populate.
        </p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "rgb(150, 150, 160)" }}
          interval="preserveStartEnd"
          minTickGap={48}
        />
        <YAxis
          domain={["auto", "auto"]}
          tick={{ fontSize: 10, fill: "rgb(150, 150, 160)" }}
          width={56}
          tickFormatter={(v) => v.toFixed(2)}
        />
        <Tooltip
          contentStyle={{
            background: "rgb(22, 22, 26)",
            border: "1px solid rgb(58, 58, 74)",
            borderRadius: 8,
            fontSize: 11,
          }}
          formatter={(value: number, name: string) => {
            const label =
              name === "mark"
                ? "Mark (TWAP 1h)"
                : name === "spot"
                  ? "Spot mark"
                  : "Index";
            return [
              value !== null && value !== undefined
                ? `$${value.toFixed(2)}`
                : "—",
              label,
            ];
          }}
        />

        {/* Index line — protocol reference (median across publishers). */}
        <Line
          type="monotone"
          dataKey="index"
          stroke="rgb(168, 85, 247)"
          strokeWidth={2}
          dot={{ r: 2, fill: "rgb(168, 85, 247)" }}
          connectNulls
          isAnimationActive={false}
        />

        {/* Spot mark — immediate per-trade impact, reconstructed from OI imbalance. */}
        <Line
          type="monotone"
          dataKey="spot"
          stroke="rgb(255, 140, 30)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
          opacity={0.65}
          connectNulls
          isAnimationActive={false}
        />

        {/* TWAP mark — funding-rate reference, heavily EMA-smoothed. */}
        <Line
          type="monotone"
          dataKey="mark"
          stroke="rgb(255, 195, 0)"
          strokeWidth={2}
          dot={{ r: 2, fill: "rgb(255, 195, 0)" }}
          connectNulls
          isAnimationActive={false}
        />

        {/* Connected wallet's position annotation. Drawn LAST so it sits on top. */}
        {userPosition && (
          <ReferenceLine
            y={Number(userPosition.entryMarkPrice) / E6}
            stroke={
              userPosition.size > 0n ? "rgb(94, 234, 212)" : "rgb(251, 113, 133)"
            }
            strokeDasharray="6 4"
            strokeWidth={1.5}
            label={{
              value:
                userPosition.size > 0n
                  ? `LONG entry $${(Number(userPosition.entryMarkPrice) / E6).toFixed(2)}`
                  : `SHORT entry $${(Number(userPosition.entryMarkPrice) / E6).toFixed(2)}`,
              position: "insideTopLeft",
              fill:
                userPosition.size > 0n ? "rgb(94, 234, 212)" : "rgb(251, 113, 133)",
              fontSize: 10,
            }}
          />
        )}
        {userPosition && positionOpenLabel && (
          <ReferenceLine
            x={positionOpenLabel}
            stroke={
              userPosition.size > 0n ? "rgb(94, 234, 212)" : "rgb(251, 113, 133)"
            }
            strokeDasharray="2 2"
            strokeWidth={1}
            opacity={0.7}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
