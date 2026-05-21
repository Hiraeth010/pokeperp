"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { useTradeActions } from "@/lib/trade";

type Side = "long" | "short";

export default function TradePanel() {
  const { publicKey } = useWallet();
  const { openPosition, ready } = useTradeActions();

  const [side, setSide] = useState<Side>("long");
  const [size, setSize] = useState("");
  const [leverage, setLeverage] = useState(3);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "pending" }
    | { kind: "ok"; signature: string }
    | { kind: "err"; error: string }
  >({ kind: "idle" });

  const handleOpen = async () => {
    const sizeUsdc = parseFloat(size);
    if (!sizeUsdc || sizeUsdc <= 0) {
      setStatus({ kind: "err", error: "Enter a position size > 0" });
      return;
    }
    const marginUsdc = sizeUsdc / leverage;
    setStatus({ kind: "pending" });
    const res = await openPosition({ side, sizeUsdc, marginUsdc });
    if (res.ok) {
      setStatus({ kind: "ok", signature: res.signature });
      setSize("");
    } else {
      setStatus({ kind: "err", error: res.error });
    }
  };

  const sideAccent = side === "long" ? "fire" : "water";
  const ctaDisabled =
    !publicKey || !ready || status.kind === "pending";

  let ctaLabel: string;
  if (!publicKey) ctaLabel = "Connect wallet";
  else if (!ready) ctaLabel = "Market not ready";
  else if (status.kind === "pending") ctaLabel = "Sending…";
  else ctaLabel = side === "long" ? "Open long" : "Open short";

  return (
    <div
      className={`tcg-card tcg-card-${sideAccent} tcg-glow-${sideAccent} space-y-5`}
    >
      <div>
        <p className="label-caps mb-2">Direction</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`py-2.5 rounded-lg text-sm transition-all ${
              side === "long" ? "btn-fire" : "btn-ghost"
            }`}
            onClick={() => setSide("long")}
            type="button"
          >
            Long
          </button>
          <button
            className={`py-2.5 rounded-lg text-sm transition-all ${
              side === "short" ? "btn-water" : "btn-ghost"
            }`}
            onClick={() => setSide("short")}
            type="button"
          >
            Short
          </button>
        </div>
      </div>

      <div>
        <p className="label-caps mb-2">Size · USDC</p>
        <input
          type="number"
          inputMode="decimal"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          placeholder="0"
          className="w-full bg-[rgb(var(--background))] border border-[rgb(var(--border-subtle))] rounded-lg px-3.5 py-2.5 text-base tabular focus:outline-none focus:border-purple-500/50 placeholder:text-[rgb(70,70,80)]"
        />
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="label-caps">Leverage</span>
          <span className="tabular text-sm font-semibold">
            {leverage.toFixed(1)}×
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={3}
          step={0.1}
          value={leverage}
          onChange={(e) => setLeverage(parseFloat(e.target.value))}
          className="w-full accent-[rgb(var(--electric-to))]"
        />
        <div className="flex justify-between text-[10px] text-[rgb(var(--muted))] mt-1.5 tabular">
          <span>1.0×</span>
          <span>2.0×</span>
          <span>3.0×</span>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-1.5 text-xs pt-1">
        <div className="flex justify-between">
          <dt className="text-[rgb(var(--muted))]">Margin (this size)</dt>
          <dd className="tabular text-[rgb(var(--foreground))]/80">
            {size ? `$${(parseFloat(size) / leverage).toFixed(2)}` : "—"}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[rgb(var(--muted))]">Taker fee</dt>
          <dd className="tabular text-[rgb(var(--foreground))]/80">0.10%</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[rgb(var(--muted))]">Funding (1h)</dt>
          <dd className="tabular text-[rgb(var(--foreground))]/80">—</dd>
        </div>
      </dl>

      <button
        onClick={handleOpen}
        disabled={ctaDisabled}
        className={`w-full py-3 rounded-lg text-sm font-semibold transition-all ${
          side === "long" ? "btn-fire" : "btn-water"
        }`}
        type="button"
      >
        {ctaLabel}
      </button>

      {status.kind === "ok" && (
        <div className="text-xs text-emerald-400 tabular break-all">
          ✓ Position opened ·{" "}
          <span className="text-[rgb(var(--muted))]">
            {status.signature.slice(0, 8)}…{status.signature.slice(-8)}
          </span>
        </div>
      )}
      {status.kind === "err" && (
        <div className="text-xs text-red-400 break-words">{status.error}</div>
      )}
    </div>
  );
}
