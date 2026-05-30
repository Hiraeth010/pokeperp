"use client";

import { useIndexState } from "@/lib/oracle";
import { formatIndex } from "@/lib/format";

/** Slim PMT50 bar for /trade — keeps the chart and trade panel above the fold
 *  while still showing the load-bearing index value and oracle status. */
export default function TradeIndexBar() {
  const state = useIndexState();

  const isReady = state.status === "ready";
  const value = isReady ? state.data.indexValue : null;
  const status = isReady ? state.data.status : "—";
  const day = isReady ? state.data.day : null;
  const finalizedAt = isReady ? state.data.finalizedAt : null;
  const updatedAgo = finalizedAt
    ? `${Math.max(0, Math.floor((Date.now() / 1000 - finalizedAt) / 60))}m ago`
    : "—";

  const statusColor: Record<string, string> = {
    Provisional: "rgb(var(--electric-to))",
    Final: "#10b981",
    Stale: "rgb(var(--muted))",
    Frozen: "#f87171",
  };

  return (
    <div className="tcg-card tcg-holo flex items-center gap-5 sm:gap-7 py-4 px-5 sm:px-6 overflow-hidden">
      <div className="relative z-[1] flex items-baseline gap-2.5 min-w-0">
        <span className="font-display text-xl tracking-tight">PMT50</span>
        <span className="text-[10px] text-[rgb(var(--muted))] uppercase tracking-wider font-semibold hidden sm:inline">
          PSA 10 Modern Top 50
        </span>
      </div>
      <div className="relative z-[1] flex items-baseline gap-2 ml-auto">
        {value !== null ? (
          <span className="font-display text-foil text-2xl sm:text-3xl tabular leading-none">
            {formatIndex(value)}
          </span>
        ) : (
          <span className="font-display text-2xl sm:text-3xl tabular text-[rgb(var(--muted))] leading-none">
            —
          </span>
        )}
        <span className="text-[10px] text-[rgb(var(--muted))] tabular">USDC</span>
      </div>
      <div className="relative z-[1] hidden md:flex items-center gap-2 pl-4 border-l border-[rgb(var(--border-subtle))]/40">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: statusColor[status] ?? "rgb(var(--muted))" }}
        />
        <span className="label-caps text-[10px]">{status}</span>
        <span className="text-[10px] text-[rgb(var(--muted))] tabular">
          {day !== null ? `· day ${day}` : ""}
        </span>
        <span className="text-[10px] text-[rgb(var(--muted))] tabular">
          · {updatedAgo}
        </span>
      </div>
    </div>
  );
}
