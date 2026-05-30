# The PMT50 Index

PMT50 (PSA 10 Modern Top 50) is the underlying that Pokeperp settles against. It
tracks the 50 most-traded modern-era Pokémon cards in PSA 10 grade, as an
equal-weighted price index.

## What goes in the index

Constituents are selected by **trailing 90-day eBay PSA 10 sold dollar volume** —
the cards people actually trade the most, by money changing hands, not just count.
To qualify, a card must be:

- **Modern era** — XY era onward (Feb 2014+).
- **English-language, PSA 10**, with no qualifier labels (no OC/ST/MK grades).
- Liquid enough: roughly ≥50 sales and ≥100 PSA population, from a set ≥180 days old.

The 50 constituents are **equal-weighted** (2% each), so no single card dominates.

## How the value is computed

Each day the index value is:

```
I = 1000 × (1/50) × Σ (Pₜ / P_base)
```

where `Pₜ` is today's aggregated price for a constituent and `P_base` is its price
when it entered the index. The index starts at **1000** and moves with the basket.

## Rebalancing

The basket is reviewed **monthly**. To avoid churn from cards bobbing around the
cutoff, there's a soft buffer: a constituent isn't dropped until it falls past
rank ~75. This keeps the index stable month to month while still tracking what's
actually trading.

## Pricing methodology

Daily prices come from real eBay PSA 10 sold listings, cleaned with a strict
pipeline: PSA-10-only filtering, qualifier rejection, English-only matching, and a
**trimmed mean** across a sale window (with wider fallback windows when a card is
thin). The result is robust to outliers and obvious bad prints.
