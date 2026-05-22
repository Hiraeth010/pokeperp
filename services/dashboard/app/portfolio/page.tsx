"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePositions } from "@/lib/perp";
import { useTradeActions, type TradeResult } from "@/lib/trade";
import { formatUsdCompact } from "@/lib/format";
import { useConstituentRegistry } from "@/lib/oracle";
import RealizedPnl from "@/components/RealizedPnl";
import CardImage from "@/components/CardImage";
import FundingChart from "@/components/FundingChart";

export default function PortfolioPage() {
  const { publicKey } = useWallet();
  const positions = usePositions(publicKey);
  const registry = useConstituentRegistry();

  // The first 3 live constituents are used as a thumbnail strip on each open
  // position to remind traders what's actually backing the index they hold.
  const previewCards =
    registry.status === "ready"
      ? registry.data.constituents.filter((c) => c.setCode !== "").slice(0, 3)
      : [];

  return (
    <div className="space-y-6">
      {!publicKey ? (
        <div className="tcg-card text-center py-12">
          <p className="label-caps mb-3">Wallet required</p>
          <p className="text-[rgb(var(--muted))]">
            Connect a wallet to view your open positions and close history.
          </p>
        </div>
      ) : (
        <>
          <section className="tcg-card">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="label-caps">Open positions</h2>
              <span className="text-[10px] text-[rgb(var(--muted))] tabular">
                {positions.status === "ready"
                  ? `${positions.data.length} open`
                  : ""}
              </span>
            </div>

            {positions.status === "loading" && (
              <p className="text-sm text-[rgb(var(--muted))]">
                Loading positions…
              </p>
            )}
            {positions.status === "error" && (
              <p className="text-sm text-red-400">{positions.error}</p>
            )}
            {positions.status === "ready" && positions.data.length === 0 && (
              <EmptyPositions />
            )}
            {positions.status === "ready" && positions.data.length > 0 && (
              <ul className="space-y-3">
                {positions.data.map((p) => (
                  <PositionCard
                    key={p.address.toBase58()}
                    position={p}
                    previewCards={previewCards}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="tcg-card">
            <h2 className="label-caps mb-4">Close history</h2>
            <RealizedPnl trader={publicKey} />
          </section>
        </>
      )}

      {/* Market-wide funding chart — visible regardless of wallet state. */}
      <section className="tcg-card">
        <FundingChart />
      </section>
    </div>
  );
}

function EmptyPositions() {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <div className="opacity-40">
        <svg width="56" height="56" viewBox="0 0 64 64" fill="none">
          <circle
            cx="32"
            cy="32"
            r="26"
            stroke="rgb(var(--muted))"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <path
            d="M22 32h20M32 22v20"
            stroke="rgb(var(--muted))"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div>
        <p className="text-sm text-[rgb(var(--foreground))]/85 mb-1">
          No positions yet
        </p>
        <p className="text-xs text-[rgb(var(--muted))]">
          Head to{" "}
          <a
            href="/trade"
            className="text-poke-electric hover:underline font-semibold"
          >
            Trade
          </a>{" "}
          to open one.
        </p>
      </div>
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
  previewCards: Array<{
    setCode: string;
    collectorNumber: number;
    variantCode: string;
  }>;
}

function PositionCard({ position, previewCards }: PositionCardProps) {
  const isLong = position.size > 0n;
  const abs = isLong ? position.size : -position.size;
  const side = isLong ? "long" : "short";
  const sideColor = isLong ? "text-orange-400" : "text-blue-400";
  const sideAccent = isLong ? "fire" : "water";

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
    <li
      className={`relative border border-[rgb(var(--border-subtle))]/40 rounded-lg p-4 tcg-glow-${sideAccent}`}
    >
      {/* Side stripe accent */}
      <span
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
        style={{
          background: isLong
            ? "linear-gradient(180deg, rgb(var(--fire-from)), rgb(var(--fire-to)))"
            : "linear-gradient(180deg, rgb(var(--water-from)), rgb(var(--water-to)))",
        }}
      />
      <div className="pl-2">
        <div className="flex items-baseline justify-between mb-2">
          <div className="flex items-baseline gap-2.5">
            <span className={`label-caps ${sideColor}`}>{side}</span>
            <span className="font-display text-sm tracking-tight">PMT25</span>
            <span className="tabular text-base text-[rgb(var(--foreground))]/90 font-semibold">
              {formatUsdCompact(abs)}
            </span>
          </div>
          <span className="text-[10px] text-[rgb(var(--muted))] tabular">
            opened {new Date(position.openedAt * 1000).toLocaleDateString()}
          </span>
        </div>
        <div className="flex items-baseline justify-between text-xs text-[rgb(var(--muted))] mb-3.5">
          <span>
            Entry mark · ${(Number(position.entryMarkPrice) / 1_000_000).toFixed(2)}
          </span>
          {previewCards.length > 0 && (
            <span className="flex items-center gap-1">
              {previewCards.map((c) => (
                <CardImage
                  key={`${c.setCode}-${c.collectorNumber}`}
                  card={c}
                  size="xs"
                  className="!w-8 !h-11"
                />
              ))}
            </span>
          )}
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
      </div>
    </li>
  );
}
