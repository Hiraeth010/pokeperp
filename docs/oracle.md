# Oracle & Publisher Design

**Version:** 0.1
**Status:** Draft
**Last updated:** 2026-05-19
**Depends on:** [methodology.md](./methodology.md)

The Pokeperp oracle is a federated push-style oracle that delivers daily PSA 10 prices for the 25 index constituents on-chain. This document specifies the publisher set, data flow, on-chain aggregation, dispute resolution, and economic security model.

---

## 1. Design goals

| Goal | Mechanism |
|---|---|
| No single publisher can move the index | Median aggregation of ≥3 independent submissions |
| No single data source can poison the index | Publishers fetch from independent paths (API, scrape, third-party aggregator) |
| Bad actors lose more than they can gain | Bond requirements + slashing on demonstrable manipulation |
| Survive eBay outages or API revocations | Multi-source fetching + stale-data fallback per methodology §6 |
| Reach permissionless eventually | Start federated, migrate to bonded permissionless in v2 |

Non-goals for v1: full permissionlessness, cryptoeconomic security competitive with Pyth/Chainlink, sub-hour update frequency.

## 2. Publisher set

### Composition (v1 target: 5 publishers)

| Slot | Role | Selection criteria |
|---|---|---|
| 1 | Pokeperp core team multisig | Operates reference implementation |
| 2 | Known Pokemon market data operator | e.g., 130point, PriceCharting, or equivalent — demonstrated multi-year price tracking |
| 3 | Independent grading/market analyst | Public reputation in the PSA community; ideally not financially exposed to a specific card |
| 4 | Solana oracle infra partner | Existing on-chain oracle operator (e.g., a Switchboard or Pyth contributor) |
| 5 | Community-elected publisher | Selected via Pokeperp governance after first 90 days |

### Onboarding requirements

- Post 10,000 USDC bond to the oracle program.
- Pass a 30-day shadow period: submit prices that are scored against the active publisher median; deviation >5% for >3 consecutive days disqualifies.
- Sign a public methodology adherence statement (off-chain, posted to repo).

### Removal

- Slashing event (see §7) removes the publisher.
- Voluntary exit: 30-day notice, bond returned after 60-day clawback window.
- Governance vote (super-majority of remaining publishers + 2-of-3 core team multisig) for misconduct that isn't strictly slashable.

## 3. Data sourcing (publisher-side, off-chain)

Each publisher independently fetches eBay PSA 10 sold listings for the 50 constituents and computes per-constituent trimmed-mean prices per methodology §6.

### Recommended source paths (publisher's choice)

- **eBay Marketplace Insights API** (requires eBay partner access — limited but authoritative)
- **eBay Browse API** with `--filter "soldItems"` (public, rate-limited)
- **Third-party aggregators**: 130point, PriceCharting, Card Ladder API
- **Auction houses**: PWCC, Goldin, Heritage (low volume but high signal)

A publisher MAY use multiple sources and combine them, provided the final price still represents trimmed-mean of PSA 10 sold transactions.

### Mandatory listing filters

Every publisher applies these before computing trimmed mean:

1. Listing title must contain `"PSA 10"` (case-insensitive, allowing variants like "PSA-10").
2. Listing matches `(set, collector number, variant)` from the canonical constituent registry (on-chain account, updated at each rebalance).
3. Drop listings where `shipping_cost > 0.5 × item_price` (shipping-based price manipulation).
4. Drop listings where buyer or seller pubkey/account appears in the shared **blacklist** (governance-maintained account on-chain, updated by 3-of-5 publishers).

## 4. Submission protocol

### Daily cadence

| Time (UTC) | Event |
|---|---|
| 00:00 | Day `T` begins. Publishers begin fetching/aggregating data for day `T-1`. |
| 20:00 | Submission window opens. |
| 23:59 | Submission window closes. |
| 00:00 (T+1) | On-chain aggregation runs. Day `T-1` index finalized provisionally. |
| 01:00 (T+1) | Challenge window closes. Day `T-1` index becomes immutable. |

### Submission format

Publishers post a `PriceUpdate` account containing:

```rust
struct PriceUpdate {
    publisher: Pubkey,           // signed by this key
    day: u32,                    // unix day number being priced
    prices: [u64; 50],           // micro-USDC per card, fixed order matches constituent registry (PMT50, v0.10)
    sale_counts: [u16; 50],      // number of sales used in trimmed mean
    source_root: [u8; 32],       // merkle root of (sale_id, price, timestamp) leaves, off-chain reproducible
    submitted_at: i64,           // slot timestamp
    signature: [u8; 64],
}
```

- `prices` ordering must match the constituent registry account at the moment of submission.
- `source_root` enables off-chain audit: anyone can ask a publisher for the merkle proof of any leaf used.
- Mid-month constituent changes (only via emergency replacement per methodology §9) cause publishers to use the updated registry from the day after the change.

## 5. On-chain aggregation

### Per-constituent aggregation

For each of the 50 constituents on day `T-1`:

1. Collect all valid `PriceUpdate` accounts for day `T-1`.
2. Filter to publishers in good standing (not slashed, not in shadow period for this submission).
3. If fewer than 3 valid submissions exist for the day → constituent marked **stale**, falls back to methodology §6 decay rule.
4. Otherwise: per-constituent price = **median** of submitted prices.

Median (not mean) because it tolerates one manipulated submission out of five without distorting the aggregate.

### Index value computation

Once all 50 constituent prices are aggregated:

```
I_{T-1} = 1000 × (1/25) × Σ (P_i / P_{i,base})
```

Where `P_{i,base}` is from the chain-linked rebase state account, updated at each monthly rebalance per methodology §7.

### Provisional vs final

- At `00:00 UTC` on day `T`: index value written as **provisional** to the `IndexState` account.
- At `01:00 UTC` on day `T`: if no successful dispute, provisional value becomes **final**. Perp engine reads only final values for funding settlement.
- Trading uses provisional values for mark-price display, but funding/liquidation reference the most recent final value.

## 6. Dispute mechanism

### Open challenge window (1 hour)

During `00:00–01:00 UTC` on day `T`, anyone may submit a `Challenge` account targeting a specific publisher's day `T-1` submission:

```rust
struct Challenge {
    challenger: Pubkey,
    target_publisher: Pubkey,
    target_day: u32,
    target_constituent_index: u8,  // 0..24
    claimed_correct_price: u64,    // challenger's assertion
    evidence_uri: String,          // off-chain: link to source listings, sale screenshots
    bond: u64,                     // CHALLENGE_BOND, e.g., 1000 USDC
}
```

### Resolution

Within 24 hours of challenge submission:

- A **dispute committee** (3-of-5 publishers excluding the targeted one + 2-of-3 core multisig) votes.
- If challenge succeeds:
  - Targeted publisher's submission for that day is excluded retroactively.
  - Aggregated price is recomputed without it.
  - Targeted publisher slashed (see §7).
  - Challenger receives slashed amount + bond returned.
- If challenge fails:
  - Challenger loses bond, split 50/50 between targeted publisher (compensation) and protocol treasury.

### Why optimistic + committee, not pure stake

True bonded dispute (UMA-style) requires a deep stake pool. v1 publisher set is too small for that to be economically secure, so the committee acts as a backstop. v2 migration plan is in §10.

## 7. Economic security

### Bonds

| Role | Bond |
|---|---|
| Publisher | 10,000 USDC |
| Challenger | 1,000 USDC per challenge |

### Rewards

Publishers split **0.1% of perp protocol fees** pro-rata by valid submissions in the prior 30 days. A publisher who misses >25% of daily submissions in a month earns nothing for that month.

### Slashing schedule

| Offense | Penalty |
|---|---|
| Successful challenge: price off by >5% from corrected median | 10% of bond, 1-month suspension |
| Successful challenge: price off by >15% | 50% of bond, 6-month suspension |
| Successful challenge: demonstrable collusion (multiple publishers, same direction, >10% off) | 100% of bond, permanent removal, governance review |
| Liveness: missed >25% of submissions in a calendar month | 5% of bond |
| Liveness: missed >75% in a month | 25% of bond, 1-month suspension |

Slashed bonds flow: 50% to challenger (if applicable), 25% to remaining publishers, 25% to protocol treasury.

## 8. Bootstrapping phases

### Phase 0: Shadow (days 0–30)

- 3 publishers (core team multisig + 2 partners) submit daily.
- Index computed and posted on-chain but **not** consumed by any live perp market.
- Public dashboard shows index, per-publisher prices, deviation.
- Goal: validate methodology and tooling before any money is at risk.

### Phase 1: Soft launch (days 31–90)

- 5 publishers active.
- Perp engine live with conservative caps: **3× leverage max**, **$50k per-trader OI cap**.
- Dispute mechanism active.
- Funding rates capped at ±0.1%/hour to limit damage from any oracle anomaly.

### Phase 2: Full launch (day 91+)

- Leverage cap raised to 5× per perp engine spec.
- OI caps raised per liquidity.
- Community publisher slot opened via governance vote.

### Phase 3: Permissionless migration (v2, post-launch)

- Bonded permissionless publishers (UMA / API3-style).
- Optimistic disputes without committee.
- Out of scope for v1.

## 9. Failure modes & circuit breakers

| Condition | Response |
|---|---|
| Fewer than 3 valid submissions for a day | Index marked stale; falls back to last-good with decay per methodology §6; perp funding accrues at 50% rate |
| Day-over-day index move >20% | Perp trading paused 2 hours; dispute committee reviews; if no consensus, trading resumes with funding paused another 24h |
| Single constituent moves >40% day-over-day | Constituent ejected from index immediately; replaced at next monthly rebalance; index re-weighted to 24 constituents at 4.17% each until then |
| eBay data outage declared (5-of-N publisher agreement) | Index frozen at last final value; perp funding paused; trading allowed but liquidation buffers widened 2× |
| Suspected coordinated publisher attack | Core multisig emergency-pause oracle for ≤48 hours pending governance review; perp funding paused, trading paused |

## 10. Open questions for v0.2

- **Commit-reveal submissions**: should publishers commit to a hash first, reveal later? Prevents copy-cat behavior where one publisher mirrors another. Adds protocol complexity. Lean toward skipping for v1.
- **Publisher rotation**: should publisher slots be term-limited (e.g., 1-year terms) to prevent entrenchment? Probably yes, but mechanics TBD.
- **Cross-chain redundancy**: should the index also be posted to a second chain (Eclipse, Ethereum L2) as a sanity check? Out of scope for v1.
- **Japanese-language card branch**: see methodology §10. If we add a parallel JP index, does it share the publisher set or run on its own? Likely shared with separate per-card oracles.
- **Path to permissionless**: concrete migration trigger (TVL? time? governance vote?) for moving to bonded permissionless model.
