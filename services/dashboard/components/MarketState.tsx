"use client";

import { useMarket, useInsuranceFund, phaseLabel } from "@/lib/perp";
import { formatUsdCompact } from "@/lib/format";

export default function MarketState() {
  const market = useMarket();
  const insurance = useInsuranceFund();

  const phase =
    market.status === "ready" ? phaseLabel(market.data.phase) : "—";

  return (
    <div className="tcg-card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="label-caps">Market state</h2>
        <span className="text-[10px] text-poke-electric tabular font-semibold tracking-wider uppercase">
          {phase}
        </span>
      </div>
      <Body market={market} insurance={insurance} />
    </div>
  );
}

function Body({
  market,
  insurance,
}: {
  market: ReturnType<typeof useMarket>;
  insurance: ReturnType<typeof useInsuranceFund>;
}) {
  if (market.status === "loading") {
    return <p className="text-sm text-[rgb(var(--muted))]">Loading…</p>;
  }
  if (market.status === "error") {
    return <p className="text-sm text-red-400">{market.error}</p>;
  }
  if (market.status === "missing") {
    return (
      <p className="text-sm text-[rgb(var(--muted))]">
        Market not yet initialized on this cluster.
      </p>
    );
  }

  const m = market.data;
  const insuranceDeposited =
    insurance.status === "ready"
      ? insurance.data.totalDeposited - insurance.data.totalPaidOut
      : null;
  const longShare =
    m.longOi + m.shortOi > 0n
      ? Number((m.longOi * 100n) / (m.longOi + m.shortOi))
      : 50;

  return (
    <dl className="space-y-3 text-sm">
      {/* Long/Short row with a visual proportion bar */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <dt className="text-[rgb(var(--muted))]">Long / Short OI</dt>
          <dd className="tabular text-[12px]">
            <span className="text-orange-400 font-semibold">
              {formatUsdCompact(m.longOi)}
            </span>
            <span className="text-[rgb(var(--muted))] mx-1.5">·</span>
            <span className="text-blue-400 font-semibold">
              {formatUsdCompact(m.shortOi)}
            </span>
          </dd>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden bg-[rgb(var(--background-elevated))] flex">
          <div
            className="h-full"
            style={{
              width: `${longShare}%`,
              background:
                "linear-gradient(90deg, rgb(var(--fire-from)), rgb(var(--fire-to)))",
            }}
          />
          <div
            className="h-full"
            style={{
              width: `${100 - longShare}%`,
              background:
                "linear-gradient(90deg, rgb(var(--water-from)), rgb(var(--water-to)))",
            }}
          />
        </div>
      </div>

      <StatRow label="OI cap (per side)" value={formatUsdCompact(m.maxOiPerSide)} />
      <StatRow
        label="Max position"
        value={formatUsdCompact(m.maxPositionPerTrader)}
      />
      <StatRow label="Taker fee" value={`${m.takerFeeBps / 100}%`} />
      <StatRow
        label="Funding cap (1h)"
        value={`±${m.fundingCapPerHourBps / 100}%`}
      />
      <StatRow
        label="Insurance fund"
        value={
          insuranceDeposited !== null ? formatUsdCompact(insuranceDeposited) : "—"
        }
      />
      <StatRow
        label="Trading"
        value={
          m.tradingPaused ? (
            <span className="text-red-400">paused</span>
          ) : (
            <span className="text-emerald-400 inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
              live
            </span>
          )
        }
      />
    </dl>
  );
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-[rgb(var(--muted))]">{label}</dt>
      <dd className="tabular text-[rgb(var(--foreground))]/85">{value}</dd>
    </div>
  );
}
