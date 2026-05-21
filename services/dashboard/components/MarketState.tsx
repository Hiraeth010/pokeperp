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
        <span className="text-[10px] text-[rgb(var(--muted))] tabular">
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
    insurance.status === "ready" ? insurance.data.totalDeposited : null;

  return (
    <dl className="space-y-2.5 text-sm">
      <StatRow label="Long OI" value={formatUsdCompact(m.longOi)} />
      <StatRow label="Short OI" value={formatUsdCompact(m.shortOi)} />
      <StatRow
        label="OI cap (per side)"
        value={formatUsdCompact(m.maxOiPerSide)}
      />
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
        value={insuranceDeposited !== null ? formatUsdCompact(insuranceDeposited) : "—"}
      />
      <StatRow
        label="Trading"
        value={
          m.tradingPaused ? (
            <span className="text-red-400">paused</span>
          ) : (
            <span className="text-emerald-400">live</span>
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
