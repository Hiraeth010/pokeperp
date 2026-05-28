"use client";

import { useIndexState, useConstituentRegistry } from "@/lib/oracle";
import { formatIndex, formatAgo } from "@/lib/format";
import CardImage from "./CardImage";

export default function IndexCard() {
  const state = useIndexState();
  const registry = useConstituentRegistry();

  // Show up to 6 thumbnails as a preview ribbon at the bottom of the hero card.
  const previewConstituents =
    registry.status === "ready"
      ? registry.data.constituents.filter((c) => c.setCode !== "").slice(0, 6)
      : [];

  if (state.status === "loading") {
    return (
      <div className="tcg-card animate-pulse p-8">
        <p className="text-[rgb(var(--muted))] text-sm">Loading index…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="tcg-card">
        <p className="label-caps mb-2">Error</p>
        <p className="text-xs text-red-400">{state.error}</p>
      </div>
    );
  }

  const isReady = state.status === "ready";
  const day = isReady ? state.data.day : null;
  const status = isReady ? state.data.status : "Pre-launch";
  const indexValue = isReady ? state.data.indexValue : null;
  const finalizedAt = isReady ? state.data.finalizedAt : null;

  const statusColor: Record<string, string> = {
    Provisional: "rgb(var(--electric-to))",
    Final: "#10b981",
    Stale: "rgb(var(--muted))",
    Frozen: "#f87171",
    "Pre-launch": "rgb(var(--muted))",
  };
  const updatedAgo = finalizedAt
    ? formatAgo(Date.now() / 1000 - finalizedAt)
    : "—";

  return (
    <div className="tcg-card tcg-holo p-7 sm:p-9 overflow-hidden">
      <div className="flex items-start justify-between mb-2 relative z-[1]">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl tracking-tight">
            PMT25
          </h1>
          <p className="text-xs text-[rgb(var(--muted))] mt-1">
            PSA 10 Modern Top 25 · {day !== null ? `day ${day}` : "perpetual index"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: statusColor[status] }}
          />
          <span className="label-caps">{status}</span>
        </div>
      </div>

      <div className="mt-7 flex items-baseline gap-3 relative z-[1]">
        {indexValue !== null ? (
          <span className="font-display text-foil text-6xl sm:text-7xl tabular leading-none">
            {formatIndex(indexValue)}
          </span>
        ) : (
          <span className="font-display text-6xl sm:text-7xl tabular text-[rgb(var(--muted))] leading-none">
            —
          </span>
        )}
        <span className="text-[rgb(var(--muted))] text-sm tabular pl-1">USDC</span>
      </div>

      <div className="mt-7 pt-5 border-t border-[rgb(var(--border-subtle))]/40 text-xs relative z-[1]">
        <span className="text-[rgb(var(--muted))]">
          {indexValue !== null
            ? `Last update ${updatedAgo} · ${status.toLowerCase()}`
            : "Oracle not yet aggregating on this cluster"}
        </span>
      </div>

      {previewConstituents.length > 0 && (
        <div className="mt-6 pt-5 border-t border-[rgb(var(--border-subtle))]/40 relative z-[1]">
          <p className="label-caps mb-3 text-[10px]">Underlying preview</p>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {previewConstituents.map((c) => (
              <CardImage
                key={`${c.setCode}-${c.collectorNumber}`}
                card={c}
                size="xs"
                className="shrink-0"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
