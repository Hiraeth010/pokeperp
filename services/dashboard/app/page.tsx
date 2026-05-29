import IndexCard from "@/components/IndexCard";
import TokenCa from "@/components/TokenCa";
import TopMovers from "@/components/TopMovers";
import MarketState from "@/components/MarketState";

export default function Home() {
  return (
    <div className="space-y-6">
      <IndexCard />
      <TokenCa />

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <TopMovers />
        <MarketState />
      </section>

      <p className="text-[11px] text-[rgb(var(--muted))] text-center pt-4">
        Index settles against trailing 90-day eBay PSA 10 sold dollar volume ·
        rebalanced monthly · English-language PSA 10 only
      </p>

      <p className="text-center pb-2">
        <a
          href="https://fomo.family/profile/PokePerpss"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-[rgb(var(--electric-from))] underline decoration-[rgb(var(--electric-from))]/40 underline-offset-2 transition-colors hover:text-[rgb(var(--electric-to))]"
        >
          Fomo DevBuyBack Holdings ↗
        </a>
      </p>
    </div>
  );
}
