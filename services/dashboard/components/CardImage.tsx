"use client";

import { useState } from "react";
import Image from "next/image";

import { cardImageUrl, type CardIdentity } from "@/lib/cards";

/** Card art with shimmer-loading placeholder + graceful fallback for unknown sets.
 *  Use the `hires` variant for >300px renders; thumbnail is fine for grid tiles. */
export default function CardImage({
  card,
  size = "md",
  hires = false,
  priority = false,
  className = "",
}: {
  card: CardIdentity;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  hires?: boolean;
  priority?: boolean;
  className?: string;
}) {
  const url = cardImageUrl(card, hires ? "hires" : "thumb");
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  // Pokemon TCG card aspect ratio is ~63 × 88 (close to 5:7).
  const dims = {
    xs: { w: 56, h: 78 },
    sm: { w: 90, h: 126 },
    md: { w: 140, h: 196 },
    lg: { w: 200, h: 280 },
    xl: { w: 300, h: 420 },
  }[size];

  return (
    <div
      className={`relative overflow-hidden rounded-lg ring-1 ring-white/10 ${className}`}
      style={{ width: dims.w, height: dims.h }}
    >
      {/* Shimmer placeholder */}
      {!loaded && (
        <div
          className="absolute inset-0 bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-white/[0.06] animate-pulse-soft"
          aria-hidden="true"
        />
      )}
      {url && !errored ? (
        <Image
          src={url}
          alt=""
          fill
          sizes={`${dims.w}px`}
          priority={priority}
          className={`object-cover transition-opacity duration-300 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setErrored(true);
            setLoaded(true);
          }}
        />
      ) : (
        <Fallback card={card} />
      )}
    </div>
  );
}

function Fallback({ card }: { card: CardIdentity }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-[rgb(var(--background-elevated))] to-[rgb(var(--background-card))] text-[rgb(var(--muted))]">
      <span className="font-display text-[10px] tracking-widest">
        {card.setCode || "???"}
      </span>
      <span className="tabular text-base font-semibold mt-0.5">
        #{card.collectorNumber}
      </span>
      {card.variantCode && (
        <span className="text-[8px] tracking-widest mt-0.5 opacity-80">
          {card.variantCode}
        </span>
      )}
    </div>
  );
}
