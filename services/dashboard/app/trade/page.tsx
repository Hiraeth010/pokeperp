"use client";

import IndexCard from "@/components/IndexCard";
import TradePanel from "@/components/TradePanel";
import MarkVsIndexChart from "@/components/MarkVsIndexChart";

export default function TradePage() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <IndexCard />

        <div className="tcg-card h-96 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h2 className="label-caps">Mark vs Index</h2>
            <div className="flex items-center gap-3 text-[10px] text-[rgb(var(--muted))]">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--electric-to))]" />
                Mark
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--psychic-from))]" />
                Index
              </span>
            </div>
          </div>
          <MarkVsIndexChart />
        </div>
      </div>

      <div>
        <TradePanel />
      </div>
    </div>
  );
}
