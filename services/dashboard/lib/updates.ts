/**
 * Pokeperp on-site updates feed (our own X-style announcement channel, so we're
 * not dependent on an X account that keeps getting deleted).
 *
 * To post a new update: add an object to the TOP of UPDATES, commit, push —
 * Vercel redeploys and it shows on /updates. `date` is a UTC YYYY-MM-DD string;
 * `body` is markdown (links, **bold**, lists all work).
 */
export type Update = {
  id: string;
  date: string; // YYYY-MM-DD (UTC)
  tag?: string; // optional badge, e.g. "News" | "Launch" | "Release"
  body: string; // markdown
};

export const UPDATES: Update[] = [
  {
    id: "2026-05-29-feed-live",
    date: "2026-05-29",
    tag: "News",
    body: "**Welcome to the Pokeperp updates feed.** This is our official, on-site home for announcements, releases, and news — straight from the team and impossible to take down. Our X account is currently down, so **this feed is the source of truth** for now — check here for everything. Bookmark it.",
  },
  {
    id: "2026-05-29-poke-buybacks",
    date: "2026-05-29",
    tag: "Token",
    body: "**$POKE is live — and the dev is buying back.** The token trades on Meteora; always verify the contract address on the home page before buying. A portion of trading-fee proceeds funds ongoing dev buybacks — track the dev buyback holdings on [FOMO](https://fomo.family/profile/PokePerpss).",
  },
  {
    id: "2026-05-28-mainnet-live",
    date: "2026-05-28",
    tag: "Launch",
    body: "**Pokeperp is live on Solana mainnet.** Go long or short the **PSA 10 Modern Top 25** — the first perpetuals DEX for graded Pokémon cards. Trading is open. The index settles against trailing 90-day eBay PSA 10 sold dollar volume, rebalanced monthly.",
  },
];
