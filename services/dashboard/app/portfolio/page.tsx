"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePositions } from "@/lib/perp";
import { useTradeActions, type TradeResult } from "@/lib/trade";
import { formatUsdCompact } from "@/lib/format";
import RealizedPnl from "@/components/RealizedPnl";

export default function PortfolioPage() {
  const { publicKey } = useWallet();
  const positions = usePositions(publicKey);

  if (!publicKey) {
    return (
      <div className="tcg-card text-center py-16">
        <p className="label-caps mb-3">Wallet required</p>
        <p className="text-[rgb(var(--muted))]">
          Connect a wallet to view your open positions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="tcg-card">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="label-caps">Open positions</h2>
          <span className="text-[10px] text-[rgb(var(--muted))] tabular">
            {positions.status === "ready" ? `${positions.data.length} open` : ""}
          </span>
        </div>

        {positions.status === "loading" && (
          <p className="text-sm text-[rgb(var(--muted))]">Loading positions…</p>
        )}
        {positions.status === "error" && (
          <p className="text-sm text-red-400">{positions.error}</p>
        )}
        {positions.status === "ready" && positions.data.length === 0 && (
          <p className="text-sm text-[rgb(var(--muted))]">
            No positions yet — head to{" "}
            <a
              href="/trade"
              className="text-[rgb(var(--electric-to))] hover:underline"
            >
              Trade
            </a>{" "}
            to open one.
          </p>
        )}
        {positions.status === "ready" && positions.data.length > 0 && (
          <ul className="space-y-3">
            {positions.data.map((p) => (
              <PositionCard
                key={p.address.toBase58()}
                position={p}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="tcg-card">
        <h2 className="label-caps mb-4">Close history</h2>
        <RealizedPnl trader={publicKey} />
      </section>

      <section className="tcg-card">
        <h2 className="label-caps mb-4">Funding · cumulative</h2>
        <p className="text-sm text-[rgb(var(--muted))]">
          Needs historical snapshots · not yet wired
        </p>
      </section>
    </div>
  );
}

interface PositionCardProps {
  position: {
    address: { toBase58: () => string };
    size: bigint;
    entryMarkPrice: bigint;
    openedAt: number;
  };
}

function PositionCard({ position }: PositionCardProps) {
  const isLong = position.size > 0n;
  const abs = isLong ? position.size : -position.size;
  const side = isLong ? "long" : "short";
  const sideColor = isLong ? "text-orange-400" : "text-blue-400";

  const { closePosition, addMargin, withdrawMargin, ready } = useTradeActions();
  const [busy, setBusy] = useState<null | "close" | "add" | "withdraw">(null);
  const [result, setResult] = useState<TradeResult | null>(null);

  const run = async (
    key: "close" | "add" | "withdraw",
    fn: () => Promise<TradeResult>
  ) => {
    setBusy(key);
    setResult(null);
    const res = await fn();
    setResult(res);
    setBusy(null);
  };

  const promptAmount = (verb: string): number | null => {
    const raw = window.prompt(`${verb} how much USDC?`);
    if (!raw) return null;
    const n = parseFloat(raw);
    return n > 0 ? n : null;
  };

  return (
    <li className="border border-[rgb(var(--border-subtle))]/40 rounded-lg p-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="flex items-baseline gap-2">
          <span className={`label-caps ${sideColor}`}>{side}</span>
          <span className="tabular text-base text-[rgb(var(--foreground))]/90">
            {formatUsdCompact(abs)}
          </span>
        </span>
        <span className="text-[10px] text-[rgb(var(--muted))] tabular">
          opened {new Date(position.openedAt * 1000).toLocaleDateString()}
        </span>
      </div>
      <div className="flex items-baseline justify-between text-xs text-[rgb(var(--muted))] mb-3">
        <span>
          Entry mark · ${(Number(position.entryMarkPrice) / 1_000_000).toFixed(2)}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          className="btn-ghost text-xs py-1.5 rounded-md"
          disabled={!ready || busy !== null}
          onClick={() => {
            const amt = promptAmount("Add margin");
            if (amt !== null) run("add", () => addMargin({ amountUsdc: amt }));
          }}
        >
          {busy === "add" ? "…" : "Add margin"}
        </button>
        <button
          type="button"
          className="btn-ghost text-xs py-1.5 rounded-md"
          disabled={!ready || busy !== null}
          onClick={() => {
            const amt = promptAmount("Withdraw margin");
            if (amt !== null)
              run("withdraw", () => withdrawMargin({ amountUsdc: amt }));
          }}
        >
          {busy === "withdraw" ? "…" : "Withdraw"}
        </button>
        <button
          type="button"
          className={`text-xs py-1.5 rounded-md font-semibold ${
            isLong ? "btn-water" : "btn-fire"
          }`}
          disabled={!ready || busy !== null}
          onClick={() => run("close", closePosition)}
        >
          {busy === "close" ? "…" : "Close"}
        </button>
      </div>
      {result?.ok && (
        <p className="mt-2 text-[10px] text-emerald-400 tabular break-all">
          ✓ {result.signature.slice(0, 12)}…
        </p>
      )}
      {result && !result.ok && (
        <p className="mt-2 text-[10px] text-red-400 break-words">
          {result.error}
        </p>
      )}
    </li>
  );
}
