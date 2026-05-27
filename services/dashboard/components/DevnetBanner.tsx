/**
 * Sitewide warning that the dashboard is currently pointing at Solana devnet.
 * Renders above the nav as a non-dismissable amber strip so visitors can't
 * miss it — important because anyone who connects a wallet here is touching
 * devnet programs + a fake USDC mint, not mainnet.  Switches/removes once
 * we point at mainnet.
 *
 * Why non-dismissable: a hidden warning that a user dismissed last week and
 * forgot about defeats the purpose.  The visual weight is intentionally
 * loud (amber on near-black) so it's obvious every visit.
 */
export default function DevnetBanner() {
  return (
    <div
      role="alert"
      className="w-full bg-gradient-to-r from-amber-500/15 via-amber-500/25 to-amber-500/15 border-b border-amber-500/40 text-amber-200"
    >
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-center gap-3 text-[11px] sm:text-xs">
        {/* Triangle alert glyph */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="text-amber-300 shrink-0"
        >
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span className="font-medium tracking-wide">
          <span className="uppercase font-bold text-amber-300 mr-1.5">
            Testing on Devnet
          </span>
          <span className="opacity-90">
            — programs + USDC are devnet test versions. Don&apos;t use real
            funds. We&apos;ll announce Mainnet launch on{" "}
            <a
              href="https://x.com/PokePerp"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-amber-400/60 underline-offset-2 hover:text-amber-100"
            >
              @PokePerp
            </a>
            .
          </span>
        </span>
      </div>
    </div>
  );
}
