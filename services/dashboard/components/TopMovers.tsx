"use client";

import {
  useIndexState,
  useConstituentRegistry,
  constituentLabel,
  type Constituent,
} from "@/lib/oracle";
import { formatPct, pctChange } from "@/lib/format";

export default function TopMovers({ limit = 5 }: { limit?: number }) {
  const index = useIndexState();
  const registry = useConstituentRegistry();

  return (
    <div className="tcg-card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="label-caps">Top movers · since rebalance</h2>
        <span className="text-[10px] text-[rgb(var(--muted))] tabular">
          constituents · 25
        </span>
      </div>
      <Body
        indexStatus={index.status}
        registryStatus={registry.status}
        rows={
          registry.status === "ready"
            ? buildRows(
                registry.data.constituents,
                index.status === "ready" ? index.data.aggregatedPrices : null,
                limit
              )
            : []
        }
      />
    </div>
  );
}

interface Row {
  label: string;
  pct: number | null;
}

function buildRows(
  constituents: Constituent[],
  currentPrices: bigint[] | null,
  limit: number
): Row[] {
  // Only show constituents whose identity has actually been written. We check setCode
  // (non-empty) because base_price can be chain-linked into placeholder slots by aggregate_day,
  // while a real constituent always has a non-empty set code.
  const live = constituents.filter((c) => c.setCode !== "");
  const rows: Row[] = live.map((c, i) => ({
    label: constituentLabel(c),
    pct: currentPrices ? pctChange(currentPrices[i] ?? 0n, c.basePrice) : null,
  }));
  return rows
    .sort((a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0))
    .slice(0, limit);
}

function Body({
  indexStatus,
  registryStatus,
  rows,
}: {
  indexStatus: string;
  registryStatus: string;
  rows: Row[];
}) {
  if (registryStatus === "loading") {
    return <p className="text-sm text-[rgb(var(--muted))]">Loading…</p>;
  }
  if (registryStatus === "missing") {
    return (
      <p className="text-sm text-[rgb(var(--muted))]">
        Registry not yet initialized.
      </p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="text-sm text-[rgb(var(--muted))]">
        Registry has no constituents seeded yet.
      </p>
    );
  }
  return (
    <ul className="space-y-2.5 text-sm">
      {rows.map((r, i) => (
        <MoverRow key={`${r.label}-${i}`} label={r.label} pct={r.pct} />
      ))}
      {indexStatus !== "ready" && (
        <li className="text-[10px] text-[rgb(var(--muted))] pt-2">
          Awaiting first oracle aggregation — change column populates once IndexState lands.
        </li>
      )}
    </ul>
  );
}

function MoverRow({ label, pct }: { label: string; pct: number | null }) {
  if (pct === null) {
    return (
      <li className="flex items-baseline justify-between">
        <span className="text-[rgb(var(--foreground))]/85 truncate pr-3">
          {label}
        </span>
        <span className="tabular text-[rgb(var(--muted))] shrink-0">—</span>
      </li>
    );
  }
  const isPositive = pct >= 0;
  const color = isPositive ? "text-orange-400" : "text-blue-400";
  return (
    <li className="flex items-baseline justify-between">
      <span className="text-[rgb(var(--foreground))]/85 truncate pr-3">
        {label}
      </span>
      <span className={`tabular ${color} font-medium shrink-0`}>
        {formatPct(pct)}
      </span>
    </li>
  );
}
