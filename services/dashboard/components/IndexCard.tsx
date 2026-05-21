"use client";

import { useIndexState } from "@/lib/oracle";
import { formatIndex } from "@/lib/format";

export default function IndexCard() {
  const state = useIndexState();

  if (state.status === "loading") {
    return (
      <div className="tcg-card animate-pulse">
        <p className="text-[rgb(var(--muted))] text-sm">Loading index…</p>
      </div>
    );
  }

  if (state.status === "missing") {
    return (
      <div className="tcg-card tcg-holo p-7 sm:p-8">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">PMT25</h1>
            <p className="text-xs text-[rgb(var(--muted))] mt-0.5">
              PSA 10 Modern Top 25 · perpetual index
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[rgb(var(--muted))]" />
            <span className="label-caps">Pre-launch</span>
          </div>
        </div>
        <div className="mt-6">
          <span className="index-display text-5xl sm:text-6xl tabular text-[rgb(var(--muted))]">
            —
          </span>
        </div>
        <div className="mt-6 pt-5 border-t border-[rgb(var(--border-subtle))]/40">
          <p className="text-xs text-[rgb(var(--muted))]">
            Oracle program not yet deployed on this cluster · index activates
            once publishers begin aggregating
          </p>
        </div>
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

  const { day, status, indexValue, finalizedAt } = state.data;
  const statusColor: Record<string, string> = {
    Provisional: "rgb(var(--electric-to))",
    Final: "#10b981",
    Stale: "rgb(var(--muted))",
    Frozen: "#f87171",
  };
  const updatedAgo = finalizedAt
    ? `${Math.max(0, Math.floor((Date.now() / 1000 - finalizedAt) / 60))}m ago`
    : "—";

  return (
    <div className="tcg-card tcg-holo p-7 sm:p-8">
      <div className="flex items-start justify-between mb-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">PMT25</h1>
          <p className="text-xs text-[rgb(var(--muted))] mt-0.5">
            PSA 10 Modern Top 25 · day {day}
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

      <div className="mt-6 flex items-baseline gap-3">
        <span className="index-display text-5xl sm:text-6xl tabular">
          {formatIndex(indexValue)}
        </span>
      </div>

      <div className="mt-6 pt-5 border-t border-[rgb(var(--border-subtle))]/40 flex items-center justify-between text-xs">
        <span className="text-[rgb(var(--muted))]">
          Last update {updatedAgo} · {status.toLowerCase()}
        </span>
        <span className="label-caps text-[rgb(var(--muted))]">24h</span>
      </div>
    </div>
  );
}
