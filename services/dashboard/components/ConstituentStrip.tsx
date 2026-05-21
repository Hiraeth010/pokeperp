"use client";

import {
  useIndexState,
  useConstituentRegistry,
  type Constituent,
} from "@/lib/oracle";
import { formatPct, pctChange } from "@/lib/format";
import CardImage from "./CardImage";
import { cardName } from "@/lib/cards";

/** Scrollable row of the underlying constituents — sits below the chart on
 *  /trade so traders see which cards back the index they're betting on. */
export default function ConstituentStrip() {
  const index = useIndexState();
  const registry = useConstituentRegistry();

  if (registry.status !== "ready") {
    return null;
  }

  const prices =
    index.status === "ready" ? index.data.aggregatedPrices : null;
  const items: Array<{ c: Constituent; pct: number | null; idx: number }> =
    registry.data.constituents
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) => c.setCode !== "")
      .map(({ c, idx }) => ({
        c,
        idx,
        pct: prices ? pctChange(prices[idx] ?? 0n, c.basePrice) : null,
      }));

  if (items.length === 0) return null;

  return (
    <div className="tcg-card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="label-caps">Underlying constituents</h2>
        <span className="text-[10px] text-[rgb(var(--muted))] tabular">
          {items.length} live · {25 - items.length} pending
        </span>
      </div>
      <div className="flex items-stretch gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        {items.map(({ c, pct }) => (
          <Tile key={`${c.setCode}-${c.collectorNumber}`} c={c} pct={pct} />
        ))}
      </div>
    </div>
  );
}

function Tile({ c, pct }: { c: Constituent; pct: number | null }) {
  const name = cardName(c) ?? `${c.setCode} #${c.collectorNumber}`;
  const positive = pct !== null && pct >= 0;
  return (
    <div className="group shrink-0 w-24 flex flex-col items-center gap-1.5">
      <CardImage card={c} size="xs" />
      <p className="text-[10px] font-semibold text-center leading-tight truncate w-full">
        {name}
      </p>
      {pct === null ? (
        <span className="text-[10px] text-[rgb(var(--muted))] tabular">—</span>
      ) : (
        <span
          className={`text-[10px] tabular font-semibold ${
            positive ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {formatPct(pct)}
        </span>
      )}
    </div>
  );
}
