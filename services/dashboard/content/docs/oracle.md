# The oracle & price integrity

Everything in Pokeperp settles against the PMT50 index, so the oracle that produces
that index is the most important — and most carefully designed — part of the
protocol. It's a **federated push oracle** with on-chain aggregation and a
permissionless dispute mechanism.

## Federated publishers

A set of bonded **publishers** independently compute daily PSA 10 prices (from eBay
sold listings via the methodology pipeline) and push them on-chain. Each publisher:

- Posts a **bond** (USDC) when they register — skin in the game.
- Starts in a **shadow period** before becoming active, so their data can be
  observed before it counts.
- Submits once per day, within a fixed submission window.

## Daily aggregation

Once submissions are in, anyone can crank `aggregate_day`. For each constituent the
protocol takes the **median** across publishers (requiring a minimum number of valid
submissions, otherwise that constituent is marked *stale* for the day). The median
makes a single bad or manipulated submission irrelevant — it can't move the index on
its own.

The aggregated value is published as **provisional**, then **finalized** after a
challenge window.

## Challenges & slashing

The oracle is kept honest by a permissionless dispute game:

1. Anyone can **open a challenge** against a specific publisher's price for a
   specific constituent, posting a challenge bond.
2. Resolution is **fully on-chain and deterministic** — no human judgment. The
   program reads the publisher's submitted price and the protocol's aggregated
   (median) price and computes the deviation in basis points:

   | Deviation | Outcome |
   |---|---|
   | < 2% | challenge dismissed |
   | 2–5% | 10% of bond slashed |
   | 5–10% | 50% slashed + publisher Suspended |
   | ≥ 10% | 100% slashed + publisher Removed |

3. On a successful challenge, the slashed bond is split between the challenger and
   the protocol treasury; on a failed one, the challenger's bond is forfeited. Either
   way, lying or sloppiness is expensive and being right is rewarded.

## Liveness

Publishers that stop submitting are also slashed on a tiered schedule (missing
3 / 7 / 14 days), so the index keeps updating and stale operators are pruned.

## Why this matters for traders

The median + bonding + challenge design means the price you're liquidated or funded
against isn't set by any one party — it's a consensus value that's expensive to
manipulate and easy to dispute. That's the trust anchor under every position.
