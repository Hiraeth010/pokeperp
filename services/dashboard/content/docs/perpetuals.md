# Trading the perp

Pokeperp is an **oracle-anchored perpetual**: there's no order book. The protocol
quotes a price off the PMT25 index, and you open leveraged long/short positions
against it with isolated margin, settled in USDC.

## Mark vs. index

- **Index** — the daily PMT25 settlement value from the oracle. It only updates
  once per UTC day (that's the resolution of the underlying sold-price data).
- **Mark** — the live trading price: `mark = index × (1 + slippage × imbalance)`,
  where imbalance is net open interest (longs − shorts). Heavy one-sided flow pushes
  the mark away from the index; that skew is what funding corrects.

Because the index is slow and the mark moves continuously, **funding** is what keeps
them tethered.

## Margin & leverage

Positions use **isolated margin** — each position has its own collateral, so a loss
on one can't drain another. Current risk parameters:

| Setting | Current |
|---|---|
| Max leverage | **5×** |
| Maintenance margin | 10% |
| Per-trader cap | 50k USDC |
| Open interest cap | 500k USDC per side |

Leverage and caps scale up as the insurance fund grows.

A small **taker fee** (0.1%) is charged on open and close.

## Funding

Every hour, longs and shorts exchange **funding** based on how far the mark sits
from the index:

- Mark **above** index → longs pay shorts.
- Mark **below** index → shorts pay longs.

The rate is capped (±0.1%/hr in Phase 1) so funding can't spike violently. This is
the mechanism that pulls the mark back toward the index over time.

## Liquidation

If your position's **equity** (margin + unrealized PnL − funding owed) falls below
the **maintenance margin** requirement, it can be liquidated by anyone (a keeper).
A liquidation penalty is split between the liquidator and the insurance fund. The
reference price used favors the position being liquidated, to avoid liquidating on
a brief mark wick.

## Insurance fund & ADL

Winning trades are paid from an **insurance fund** seeded by the protocol and topped
up by fees and liquidation penalties. If the fund can't fully cover a payout, the
protocol falls back to **auto-deleveraging (ADL)** — trimming the highest-PnL
positions on the opposite side — rather than going insolvent. This keeps the system
solvent even in extreme moves.
