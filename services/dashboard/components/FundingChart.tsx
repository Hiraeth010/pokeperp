"use client";

import { useEffect, useState } from "react";
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

interface MarketSnapshot {
  ts: number;
  cumulativeFundingLong: string; // i128 stored as string by clean()
}

interface ChartPoint {
  t: number;
  label: string;
  /** Funding accumulator scaled to percentage. */
  cumulativePct: number;
}

/**
 * cumulative_funding_long is an i128 micro-percent-scaled accumulator. Each
 * hour, the funding rate (×1e6 = `(mark - index) × 1e6 / index`, clamped to
 * ±funding_cap_per_hour_bps × 100) is added. To display as a percentage:
 *   pct = accumulator / 1e6 × 100 = accumulator / 1e4.
 *
 * Range in practice: cap is 10 bps/hour = 1000 in 1e6 scale → over 24 hrs at
 * the cap, accumulator = 24000 → 2.4%. Domain will auto-fit either side of 0.
 */
const E4 = 10_000;

export default function FundingChart() {
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/snapshots/market?limit=300");
        const snaps = (await res.json()) as MarketSnapshot[];
        if (cancelled) return;
        const points: ChartPoint[] = snaps.map((s) => ({
          t: s.ts,
          label: new Date(s.ts).toLocaleTimeString(),
          cumulativePct: Number(BigInt(s.cumulativeFundingLong)) / E4,
        }));
        setData(points);
        setLoaded(true);
      } catch (e) {
        console.error("FundingChart load failed", e);
        setLoaded(true);
      }
    };

    load();
    const i = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  if (!loaded) {
    return (
      <p className="text-sm text-[rgb(var(--muted))]">Loading funding…</p>
    );
  }

  if (data.length === 0) {
    return (
      <p className="text-sm text-[rgb(var(--muted))]">
        Waiting for indexer market snapshots.
      </p>
    );
  }

  // Compute display extremes for the headline summary.
  const last = data[data.length - 1].cumulativePct;
  const maxAbs = data.reduce(
    (m, p) => Math.max(m, Math.abs(p.cumulativePct)),
    0
  );

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <div className="flex items-baseline gap-3">
          <span className="label-caps">Cumulative funding</span>
          <span
            className={`tabular text-base font-semibold ${
              last > 0
                ? "text-orange-400"
                : last < 0
                  ? "text-blue-400"
                  : "text-[rgb(var(--muted))]"
            }`}
          >
            {last > 0 ? "+" : ""}
            {last.toFixed(4)}%
          </span>
        </div>
        <span className="text-[10px] text-[rgb(var(--muted))] tabular">
          peak |Δ| {maxAbs.toFixed(4)}%
        </span>
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 5, right: 8, left: 0, bottom: 0 }}
          >
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
              tickFormatter={(v: number) => `${v.toFixed(3)}%`}
            />
            <Tooltip
              contentStyle={{
                background: "rgb(22, 22, 26)",
                border: "1px solid rgb(58, 58, 74)",
                borderRadius: 8,
                fontSize: 11,
              }}
              formatter={(value: number) => [`${value.toFixed(4)}%`, "Funding"]}
            />
            <ReferenceLine
              y={0}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={1}
            />
            <Line
              type="monotone"
              dataKey="cumulativePct"
              stroke="rgb(255, 195, 0)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-[rgb(var(--muted))] mt-3 leading-snug">
        Market-wide accumulator. Longs pay when the line trends up (mark &gt; index),
        receive when it trends down. Per-position settlement applies the delta
        between snapshot and current at close / modify / liquidate.
      </p>
    </div>
  );
}
