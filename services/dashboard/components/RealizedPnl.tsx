"use client";

import { useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";

interface CloseEvent {
  ts: number;
  pubkey: string;
  trader: string;
  size: string;
  entryIndexPrice: string;
  entryMarkPrice: string;
  openedAt: string;
  // v0.3: indexer parses the close tx and emits these.
  closeSig?: string;
  closeSlot?: number;
  payoutMicro?: string;
  marginAtCloseMicro?: string;
  realizedPnlMicro?: string;
}

const E6 = 1_000_000;

export default function RealizedPnl({ trader }: { trader: PublicKey | null }) {
  const [events, setEvents] = useState<CloseEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!trader) {
      setEvents([]);
      setLoading(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(
          `/api/snapshots/closes?trader=${trader.toBase58()}&limit=50`
        );
        const data = (await res.json()) as CloseEvent[];
        if (!cancelled) {
          setEvents(data);
          setLoading(false);
        }
      } catch (e) {
        console.error("RealizedPnl load failed", e);
        if (!cancelled) setLoading(false);
      }
    };

    load();
    const i = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, [trader]);

  if (loading) {
    return <p className="text-sm text-[rgb(var(--muted))]">Loading history…</p>;
  }
  if (!trader) {
    return (
      <p className="text-sm text-[rgb(var(--muted))]">
        Connect a wallet to see your close history.
      </p>
    );
  }
  if (events.length === 0) {
    return (
      <p className="text-sm text-[rgb(var(--muted))]">
        No closed positions yet. Closes appear here within ~5s of the on-chain
        tx confirming.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-[rgb(var(--border-subtle))]/40">
      {events.map((e) => {
        const sizeRaw = BigInt(e.size);
        const isLong = sizeRaw > 0n;
        const abs = isLong ? sizeRaw : -sizeRaw;
        const side = isLong ? "long" : "short";
        const sideColor = isLong ? "text-orange-400" : "text-blue-400";
        const openedDate = new Date(Number(e.openedAt) * 1000);
        const closedDate = new Date(e.ts);
        const heldMinutes = Math.max(
          0,
          Math.floor((closedDate.getTime() - openedDate.getTime()) / 60_000)
        );
        const pnlMicro = e.realizedPnlMicro
          ? BigInt(e.realizedPnlMicro)
          : null;
        const pnlUsd =
          pnlMicro !== null ? Number(pnlMicro) / E6 : null;
        const pnlPositive = pnlMicro !== null && pnlMicro > 0n;
        const pnlNegative = pnlMicro !== null && pnlMicro < 0n;
        return (
          <li
            key={e.pubkey}
            className="py-2.5 text-sm flex items-baseline justify-between gap-3"
          >
            <div className="flex items-baseline gap-2 min-w-0">
              <span className={`label-caps ${sideColor}`}>{side}</span>
              <span className="tabular text-[rgb(var(--foreground))]/85 shrink-0">
                ${(Number(abs) / E6).toFixed(2)}
              </span>
              <span className="text-[10px] text-[rgb(var(--muted))] tabular truncate">
                held {heldMinutes}m
              </span>
            </div>
            <div className="flex items-baseline gap-3 shrink-0">
              {pnlUsd !== null ? (
                <span
                  className={`tabular text-sm font-semibold ${
                    pnlPositive
                      ? "text-emerald-400"
                      : pnlNegative
                        ? "text-rose-400"
                        : "text-[rgb(var(--muted))]"
                  }`}
                  title={
                    e.payoutMicro && e.marginAtCloseMicro
                      ? `payout $${(Number(BigInt(e.payoutMicro)) / E6).toFixed(2)} − margin $${(Number(BigInt(e.marginAtCloseMicro)) / E6).toFixed(2)}`
                      : undefined
                  }
                >
                  {pnlPositive ? "+" : ""}
                  {pnlUsd.toFixed(2)}
                </span>
              ) : (
                <span className="text-[10px] text-[rgb(var(--muted))] tabular">
                  pnl —
                </span>
              )}
              <div className="text-[10px] text-[rgb(var(--muted))] tabular shrink-0">
                {closedDate.toLocaleTimeString()}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
