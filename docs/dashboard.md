# Trader Dashboard Design

**Version:** 0.1
**Status:** Draft
**Last updated:** 2026-05-19
**Depends on:** [methodology.md](./methodology.md), [oracle.md](./oracle.md), [perp-engine.md](./perp-engine.md)

The trader dashboard is the user-facing web application for the Pokeperp perp DEX. It surfaces the live PMT25 index value, the 25 constituent prices, the perp market state, and the trade / margin / liquidation flows.

This document specifies pages, read and write data flows, key UI decisions, and the open questions a real implementation must answer.

---

## 1. Goals

- A trader can land on the dashboard, see the current index value, and understand what's driving it in under 10 seconds.
- A trader can open a long or short with at most three clicks from the home page.
- Open positions, accrued funding, and liquidation distance are visible without leaving the trade view.
- The oracle / publisher state is transparent — anyone can see who submitted today, what they reported, and any open challenges.
- No third-party tracking. No wallet-connection auto-popup. No dark patterns.

## 2. Page list

| Path | Purpose | Read sources |
|---|---|---|
| `/` | Index overview: current value, 24h/7d/30d sparkline, constituent contribution preview | `IndexState`, recent `IndexState` history |
| `/index` | Full 25-constituent breakdown: per-card price, 24h change, sample count, source attribution | `IndexState`, `ConstituentRegistry` |
| `/trade` | Open / modify / close perp positions | `Market`, `Position` (caller), `IndexState` |
| `/portfolio` | Caller's open positions, realized PnL, funding history | `Position` (all for caller), funding event logs |
| `/oracle` | Publisher submissions for today, per-publisher deviations, open challenges | `PriceUpdate` (all for current day), `Challenge` accounts |
| `/methodology` | Plain-language explanation linking to docs | Static; renders `methodology.md` |

v0.1 scaffold covers `/`, `/trade`, `/portfolio`. The others are stubs.

## 3. Read path

```
┌────────────┐    websocket subscription    ┌────────────────────────┐
│  Dashboard │◀──────────────────────────────│  Solana RPC            │
│  (Next.js) │     getProgramAccounts /      │  (oracle + perp        │
│            │     account subscriptions     │   program accounts)    │
└────────────┘                                └────────────────────────┘
```

- **Initial load**: server-side render (Next.js RSC) fetches latest `IndexState`, `ConstituentRegistry`, `Market` via a public RPC. Renders the shell with current values.
- **Live updates**: client-side hook (`useAccountSubscription`) opens WebSocket subscriptions to `IndexState` and `Market` accounts. Components re-render on any change.
- **Historical index**: dashboard maintains a small SQLite (or DuckDB or hosted PG) cache of past `IndexState` finalizations for sparklines + charts. Backfilled by an indexer (see §7).
- **Trader-specific data** (`Position` accounts): fetched on wallet connection via `getProgramAccounts` filtered by `trader = wallet.publicKey`.

## 4. Write path

```
trader click  ─▶  build tx (anchor-ts)  ─▶  wallet adapter sign  ─▶  RPC sendTransaction
                       │
                       ▼
              local optimistic update
                       │
                       ▼
              wait for confirmation
                       │
                       ▼
              reconcile with on-chain
```

- **Wallet adapter**: standard `@solana/wallet-adapter-react` with Phantom, Solflare, Backpack support.
- **Optimistic UI**: after signing, immediately show the position as opening; reconcile on confirmation. On failure (timeout, simulation revert), roll back and toast an error.
- **Transaction simulation**: every write tx is simulated before signing to catch obvious failures (insufficient margin, OI cap). Surface human-readable errors mapped from `PerpError` enum.

## 5. UI sections

### Home (`/`)

```
┌──────────────────────────────────────────────────────────────────────┐
│  PMT25                                                       1,124.7 │
│  +2.3% (24h)                                                          │
│                                                                      │
│  [────── 24h sparkline ──────────────────────────────────────────]   │
│                                                                      │
│  Top movers (24h)              Open interest                          │
│  ▲ Gengar VMAX AA   +8.1%       Long: 1.2M USDC                       │
│  ▲ Rayquaza VMAX AA +5.4%       Short: 0.9M USDC                      │
│  ▼ Charizard VSTAR  -2.1%       Funding (1h): +0.04%                  │
│                                                                      │
│  [ Trade ]   [ View constituents ]   [ How does this work? ]          │
└──────────────────────────────────────────────────────────────────────┘
```

### Trade (`/trade`)

```
┌────────────────────────────┬────────────────────────────────────────┐
│                            │  Open position                          │
│  Chart (mark + index)      │                                         │
│                            │  [ LONG ] [ SHORT ]                     │
│  ┌──────────────────────┐  │                                         │
│  │                      │  │  Size:        [_____] USDC              │
│  │                      │  │  Leverage:    [▬▬▬○──] 3.0×             │
│  │                      │  │  Margin:      125 USDC                  │
│  │                      │  │                                         │
│  │                      │  │  Liq price:   1,054.2 (est)             │
│  │                      │  │  Funding (1h): +0.04%                   │
│  │                      │  │  Taker fee:   0.10%                     │
│  └──────────────────────┘  │                                         │
│                            │  [ Connect Wallet ]                     │
├────────────────────────────┴────────────────────────────────────────┤
│  Your positions                                                      │
│  Side   Size     Entry    Mark     PnL       Funding  Liq    Action  │
│  Long   500      1,118.2  1,124.7  +3.27     -0.12    1,054  [Close] │
└─────────────────────────────────────────────────────────────────────┘
```

### Portfolio (`/portfolio`)

- Open positions table (same as bottom of trade view but larger)
- Historical realized PnL chart
- Cumulative funding paid/received
- Cumulative fees paid
- "Export to CSV" for tax purposes

### Oracle (`/oracle`)

- Today's publisher submissions: 5 rows (one per publisher), 25 columns (one per constituent), median highlighted
- Deviation per publisher per constituent (visualized as heatmap)
- Open challenges with status + remaining-window timer
- Publisher reputation: total submissions, missed days, slash events

## 6. Key UI decisions

- **No price impact slider.** Slippage is deterministic from `slippage_factor × imbalance` (perp-engine.md §3). Show estimated slippage, don't accept user-set max.
- **Liquidation price is always shown, never hidden.** Calculated client-side from position state + Market params.
- **Funding rate is shown in three units simultaneously**: per-hour bps (matches contract), per-year %, and "what $1000 will pay/earn in 24h". Different traders read different units.
- **Daily index TWAP, not real-time.** The mark price floats continuously but the index updates once per day. UI must make this distinction obvious: "Index: 1,124.7 (set at 00:00 UTC) · Mark: 1,128.3 (live)".
- **Connect wallet is bottom-right, not center-top.** Read-only browsing should never require a wallet — only writes do.
- **Mobile**: trade view collapses chart below position-opening form; tables become cards. Liquidation distance is always visible.

## 7. Indexer / off-chain helpers

The dashboard alone cannot reconstruct historical state (Solana RPC doesn't retain finalized account history past a window). A lightweight indexer is needed:

- Subscribe to `IndexState` account changes
- On every finalization, write `(day, index_value, per_constituent_prices)` to a PG / SQLite table
- Expose `/api/history` from the Next.js app via a route handler that reads this table

Out of scope for v0.1 scaffold; flagged in §10 below.

## 8. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | RSC for fast initial load; route handlers cover API needs |
| Language | TypeScript | Mandatory for Solana SDK type-safety |
| Styling | Tailwind CSS | Fast iteration, no naming overhead |
| Charts | Recharts | Decent quality, no premium |
| Solana | `@solana/web3.js` + `@solana/wallet-adapter-react` | Standard, well-maintained |
| Anchor | `@coral-xyz/anchor` | Typed program client generated from IDLs |
| Server state | Tanstack Query | Polling, caching, optimistic updates |

Deliberately not in v0.1: shadcn/ui, Privy, Web3Auth, Sentry, PostHog. Keep the surface minimal.

## 9. Security considerations

- **No private keys in the browser**. All signing goes through the wallet adapter.
- **All write paths simulate before signing**. Show the simulated result to the user.
- **CSP**: lock down inline scripts, restrict connect-src to the configured RPC.
- **Liquidation prevention prompts**: if a trader is approaching MM, surface a banner before they leave the page.

## 10. Open questions for v0.2

- **RPC strategy**: public RPC for read, user wallet for write — but public RPC rate limits will bite during volatile periods. Helius / Triton tier? Bear cost vs. degraded UX.
- **Indexer hosting**: self-host on a single small VM (cheap, but a SPOF) or use Helius webhooks / Substreams? Lean toward self-hosted for v0.1 given budget.
- **Mobile-first vs desktop-first**: the trade flow benefits from a wide layout (chart + form side by side), but most retail Solana traders are mobile. Should we ship a mobile-optimized variant first?
- **Liquidation alerts**: should the dashboard offer push notifications (web push) when a position approaches liquidation? Useful but requires service worker + opt-in flow.
- **Embedded methodology renderer**: should `/methodology` render the Markdown spec inline, or link out to GitHub? Inline gives a cleaner brand experience but duplicates the source of truth.
