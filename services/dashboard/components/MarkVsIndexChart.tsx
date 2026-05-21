"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
  mark: number | null;
  index: number | null;
  label: string;
}

const E6 = 1_000_000;

export default function MarkVsIndexChart() {
  const [data, setData] = useState<ChartPoint[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [markRes, idxRes] = await Promise.all([
          fetch("/api/snapshots/market?limit=300").then((r) => r.json()),
          fetch("/api/snapshots/index?limit=300").then((r) => r.json()),
        ]);
        if (cancelled) return;

        const market = markRes as MarketPoint[];
        const index = idxRes as IndexPoint[];

        // Build a unified time series: one point per unique timestamp.
        // Market points provide mark; index points provide index. After merge,
        // forward-fill index so a market-only point still shows the most recent index.
        const points = new Map<number, ChartPoint>();
        for (const m of market) {
          const mark = Number(m.markTwap1H) / E6;
          points.set(m.ts, {
            t: m.ts,
            mark: mark > 0 ? mark : null,
            index: null,
            label: new Date(m.ts).toLocaleTimeString(),
          });
        }
        for (const i of index) {
          const idxVal = Number(i.indexValue) / E6;
          const existing = points.get(i.ts);
          if (existing) {
            existing.index = idxVal;
          } else {
            points.set(i.ts, {
              t: i.ts,
              mark: null,
              index: idxVal,
              label: new Date(i.ts).toLocaleTimeString(),
            });
          }
        }
        const sorted = [...points.values()].sort((a, b) => a.t - b.t);

        // Forward-fill the index value, then backward-fill remaining nulls.
        // Backward-fill matters when the indexer starts mid-stream: market
        // snapshots from before the first index snapshot still get a value.
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

        setData(sorted);
      } catch (e) {
        console.error("MarkVsIndexChart load failed", e);
      }
    };

    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

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
          formatter={(value: number, name: string) => [
            value !== null && value !== undefined
              ? `$${value.toFixed(2)}`
              : "—",
            name === "mark" ? "Mark" : "Index",
          ]}
        />
        <Line
          type="monotone"
          dataKey="mark"
          stroke="rgb(255, 195, 0)"
          strokeWidth={2}
          dot={{ r: 2, fill: "rgb(255, 195, 0)" }}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="index"
          stroke="rgb(168, 85, 247)"
          strokeWidth={2}
          dot={{ r: 2, fill: "rgb(168, 85, 247)" }}
          connectNulls
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
