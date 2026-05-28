"use client";

import { useState } from "react";

/** Official $POKE token contract address. Driven by NEXT_PUBLIC_TOKEN_CA so it
 *  can be hidden/shown without a code change:
 *    - env set   → show the address + copy button
 *    - env unset → keep the pill + wording, show a "revealed at launch" placeholder
 *  To reveal at launch, set NEXT_PUBLIC_TOKEN_CA=<mint> in Vercel and redeploy. */
const CA = process.env.NEXT_PUBLIC_TOKEN_CA ?? "";

export default function TokenCa() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!CA) return;
    try {
      await navigator.clipboard.writeText(CA);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can still select the text */
    }
  };

  return (
    <div className="tcg-card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="label-caps mb-1">
          <span className="text-[rgb(var(--electric-from))]">$POKE</span> Contract Address
        </p>
        {CA ? (
          <p className="font-mono text-xs sm:text-sm break-all leading-snug">{CA}</p>
        ) : (
          <p className="font-mono text-xs sm:text-sm leading-snug text-[rgb(var(--muted))]">
            Revealed at launch — coming soon
          </p>
        )}
        <p className="mt-1 text-[10px] text-[rgb(var(--muted))]">
          Token launching soon — always verify the CA here before buying.
        </p>
      </div>
      {CA && (
        <button
          type="button"
          onClick={copy}
          aria-label="Copy $POKE contract address"
          className="shrink-0 self-start sm:self-auto rounded-lg border border-[rgb(var(--border-subtle))] px-3 py-2 text-xs font-semibold transition hover:bg-white/5"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      )}
    </div>
  );
}
