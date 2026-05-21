"use client";

import {
  useIndexState,
  useConstituentRegistry,
  type Constituent,
} from "@/lib/oracle";
import { formatPct, pctChange } from "@/lib/format";
import CardImage from "./CardImage";
import TypeBadge, { toneForVariant } from "./TypeBadge";
import { cardName, variantLabel } from "@/lib/cards";

interface Row {
  c: Constituent;
  pct: number | null;
}

export default function TopMovers({ limit = 6 }: { limit?: number }) {
  const index = useIndexState();
  const registry = useConstituentRegistry();

  const rows =
    registry.status === "ready"
      ? buildRows(
          registry.data.constituents,
          index.status === "ready" ? index.data.aggregatedPrices : null,
          limit
        )
      : [];

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
        rows={rows}
      />
    </div>
  );
}

function buildRows(
  constituents: Constituent[],
  currentPrices: bigint[] | null,
  limit: number
): Row[] {
  const live = constituents
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.setCode !== "");
  const rows: Row[] = live.map(({ c, i }) => ({
    c,
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
    <>
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
        {rows.map((r) => (
          <MoverTile key={`${r.c.setCode}-${r.c.collectorNumber}`} row={r} />
        ))}
      </ul>
      {indexStatus !== "ready" && (
        <p className="text-[10px] text-[rgb(var(--muted))] pt-3">
          Awaiting first oracle aggregation — change populates once IndexState lands.
        </p>
      )}
    </>
  );
}

function MoverTile({ row }: { row: Row }) {
  const { c, pct } = row;
  const name = cardName(c);
  const sub = name ? `${c.setCode} #${c.collectorNumber}` : variantLabel(c.variantCode);
  const positive = pct !== null && pct >= 0;
  return (
    <li className="group relative flex flex-col items-stretch gap-2.5">
      <div className="relative mx-auto tcg-holo-strong overflow-hidden rounded-lg">
        <CardImage card={c} size="sm" />
      </div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold leading-tight truncate">
            {name ?? `${c.setCode} #${c.collectorNumber}`}
          </p>
          <p className="text-[10px] text-[rgb(var(--muted))] truncate mt-0.5">
            {sub}
          </p>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {pct === null ? (
            <span className="tabular text-[11px] text-[rgb(var(--muted))]">—</span>
          ) : (
            <span
              className={`tabular text-[11.5px] font-semibold ${
                positive ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {formatPct(pct)}
            </span>
          )}
          <TypeBadge tone={toneForVariant(c.variantCode)}>
            {c.variantCode}
          </TypeBadge>
        </div>
      </div>
    </li>
  );
}
