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
    id: "2026-05-29-5x-live",
    date: "2026-05-29",
    tag: "Release",
    body: `**5× leverage is live.** You can now go up to **5×** long or short on the PSA 10 Modern Top 25 — live on-chain and usable right now on the site. Per-trader and open-interest caps stay conservative for now and scale up as the insurance fund grows. [On-chain proof ↗](https://solscan.io/tx/93JMP5BoG8Z6oy7J2FvBuzEzSjZ1RZfJ8WK8ZK9fCYgHJ5zgLmtxz4o4N2H7yWsuq82zBAuZ1gHTaWT8pjMS31Y)

**Reliability upgrade.** Live market and index data now stream over our hardened RPC path — a more stable connection with fewer hiccups.`,
  },
  {
    id: "2026-05-29-since-launch",
    date: "2026-05-29",
    tag: "Changelog",
    body: `**Since launch:**

- **12 SOL** of buybacks have gone into the $POKE chart in total.
- Fixed an indexer config that was displaying data incorrectly, which reset the chart. The on-chain data was always correct — it was purely a visual issue.
- **2 major bugs** were hunted and patched, upgrading the perp engine on-chain.`,
  },
  {
    id: "2026-05-29-tokenomics",
    date: "2026-05-29",
    tag: "Tokenomics",
    body: `**How the 5% / 5% tax works — and where it goes.** Every buy and sell carries a 5% tax:

- **Treasury** — a portion funds marketing, protocol updates, and ongoing development.
- **Insurance fund** — the bulk goes here. As we onboard more active users, run more testing, and grow the index, a larger insurance fund lets us safely raise available leverage. Leverage is capped at **3x** today; the goal is **100x**, but the insurance fund needs to be much larger before that's possible.

**90% buyback model.** All protocol fees generated are used to buy back $POKE and flywheel the token (the remaining 10% routes to the insurance fund). This allocation stays flexible and may adjust as the product scales.

**Dev supply (10%) is locked & vested** in the contract config itself — releasing 5M $POKE every 15 days to the deployer wallet, starting ~15 days from migration. This supply will never be sold by the team; it will be used strategically. [On-chain proof ↗](https://solscan.io/tx/5zxaVrQG8iHqfdGv78tHirtDJSqpaAqWb1Ci4gX6mGdo3QJPnpY8LuKDsaTbqA5MW7rzVNXo9tivT8TNCAX96R9M)`,
  },
  {
    id: "2026-05-29-feed-live",
    date: "2026-05-29",
    tag: "News",
    body: "**Welcome to the Pokeperp updates feed.** This is our official, on-site home for announcements, releases, and news — straight from the team and impossible to take down. Our X account is bugged. Bookmark it.",
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
