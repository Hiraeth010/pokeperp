/**
 * Sitewide status strip above the nav. Picks its message from build-time env so
 * the network cutover is a pure Vercel env flip (no code change):
 *
 *   NEXT_PUBLIC_NETWORK !== "mainnet"           → amber "Testing on Devnet" warning
 *   NEXT_PUBLIC_NETWORK === "mainnet" &&
 *     NEXT_PUBLIC_TRADING_LIVE !== "true"        → blue "Live on mainnet, trading opens soon"
 *   NEXT_PUBLIC_NETWORK === "mainnet" &&
 *     NEXT_PUBLIC_TRADING_LIVE === "true"        → no banner (fully live)
 *
 * Non-dismissable on purpose: a warning a user dismissed last week and forgot
 * defeats the point.
 */
const NETWORK = process.env.NEXT_PUBLIC_NETWORK;
const TRADING_LIVE = process.env.NEXT_PUBLIC_TRADING_LIVE === "true";

const Alert = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export default function DevnetBanner() {
  // Fully live on mainnet → no banner.
  if (NETWORK === "mainnet" && TRADING_LIVE) return null;

  // Live on mainnet, trading not yet enabled.
  if (NETWORK === "mainnet") {
    return (
      <div role="status" className="w-full bg-gradient-to-r from-sky-500/10 via-sky-500/20 to-sky-500/10 border-b border-sky-500/40 text-sky-200">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-center gap-3 text-[11px] sm:text-xs">
          <span className="font-medium tracking-wide">
            <span className="uppercase font-bold text-sky-300 mr-1.5">Live on Mainnet</span>
            <span className="opacity-90">
              — the PMT25 index is live on-chain. Trading isn&apos;t open yet; we&apos;ll announce on{" "}
              <a href="https://x.com/PokePerp" target="_blank" rel="noopener noreferrer"
                className="underline decoration-sky-400/60 underline-offset-2 hover:text-sky-100">@PokePerp</a>.
            </span>
          </span>
        </div>
      </div>
    );
  }

  // Default: devnet warning.
  return (
    <div role="alert" className="w-full bg-gradient-to-r from-amber-500/15 via-amber-500/25 to-amber-500/15 border-b border-amber-500/40 text-amber-200">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-center gap-3 text-[11px] sm:text-xs">
        <span className="text-amber-300"><Alert /></span>
        <span className="font-medium tracking-wide">
          <span className="uppercase font-bold text-amber-300 mr-1.5">Testing on Devnet</span>
          <span className="opacity-90">
            — programs + USDC are devnet test versions. Don&apos;t use real funds. We&apos;ll announce Mainnet launch on{" "}
            <a href="https://x.com/PokePerp" target="_blank" rel="noopener noreferrer"
              className="underline decoration-amber-400/60 underline-offset-2 hover:text-amber-100">@PokePerp</a>.
          </span>
        </span>
      </div>
    </div>
  );
}
