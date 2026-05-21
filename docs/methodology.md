# PSA 10 Modern Top 25 Index — Methodology

**Version:** 0.2
**Status:** Draft
**Last updated:** 2026-05-19

The Pokeperp Modern Top 25 (PMT25) is a price index tracking the 25 most-traded PSA 10 graded Pokemon cards from the modern era. It is the settlement reference for the Pokeperp perpetual futures market.

### Changes from v0.1

- §1: Explicit rules added for **PSA 10 qualifier exclusion** and **English-only language**.
- §3: Eligibility filter table extended with the language and qualifier rules.
- §9: Edge cases significantly expanded — Pokemon Center stamps, parallel mini-set numbering (Trainer Gallery / Galarian Gallery), SAR/SIR title-matching logic, and a canonical constituent-registry matching protocol that publishers must follow.
- §10: Resolved items removed; open questions reframed for v0.3.

---

## 1. Universe

- **Era**: "Modern" is defined as XY era onward — any card from a Pokemon TCG set released on or after **February 1, 2014**.
- **Grade**: PSA 10 only. CGC, BGS, SGC, and other graders' equivalents are not eligible. PSA 10 has the deepest liquidity premium and standardizing on a single grader produces a single, clean price curve per card.
- **Qualifier labels excluded**: PSA grades that carry a qualifier label (OC = off-center, ST = staining, MK = marks, PD = print defect, MC = miscut) are excluded from price computation, even if the underlying grade is "10". A qualifier-flagged PSA 10 trades at a meaningful discount to a clean PSA 10, so blending them would distort the index. Publishers filter eBay listing titles to clean `"PSA 10"` only.
- **Language**: English-language printings only. Japanese, Korean, Chinese, German, French, Italian, Spanish, and Portuguese printings of the same card are tracked as distinct cards and none are eligible for the PMT25 index in v1. (A companion "Japanese Modern Top 25" index is deferred to a future version.)
- **Card identity**: Each constituent is a unique tuple of `(set, collector number, variant)`. Alt arts, secret rares, rainbow rares, and promo-stamped variants of the same Pokemon are treated as separate constituents. The (set, collector number, variant) tuple stored in the on-chain constituent registry is **authoritative** — see §9.8 for the matching protocol publishers must follow.

## 2. Constituent selection

The 25 constituents are the cards with the highest **trailing 90-day eBay PSA 10 sold dollar volume**, where:

```
dollar_volume(card) = sold_count_90d × median_sold_price_90d
```

Dollar volume is preferred over raw transaction count because raw count favors $200 cards over $5,000 cards even when the latter has 10× more capital flowing through it. The index is meant to track where money actually moves, not where listings cluster.

## 3. Eligibility filters

A card must pass **all** of the following before being eligible for inclusion:

| Filter | Threshold | Rationale |
|---|---|---|
| Set release age | ≥180 days | Lets PSA pop and price normalize after release hype |
| PSA 10 sales (trailing 90d) | ≥50 | Liquidity floor; below this the price is noise |
| PSA population | ≥100 | Excludes ultra-rare singletons that are auction-only |
| Card type | Not error / misprint / signed / sealed / serialized promo | These are single-unit markets, not fungible |
| Language | English only | JP / other-language printings trade in separate markets — see §1 |
| PSA qualifier | None (clean PSA 10 only) | Qualifier-flagged grades trade at a discount — see §1 |

## 4. Weighting

Equal weight: **4% per constituent**. Re-equalized at every rebalance.

Equal weighting is chosen over market-cap weighting because cap weighting would concentrate ~60% of the index in 3-4 chase cards (Charizard alt arts, Umbreon VMAX Alt) and let a whale push the entire index by sniping one card.

## 5. Rebalance cadence

- **Monthly**, on the **1st of each month at 00:00 UTC**.
- Provisional constituent list announced **7 days in advance** (on the 24th-25th of the prior month).
- Rebalance is computed from the trailing 90-day window ending on the announcement date.

### Soft buffer (anti-thrashing)

Pokemon prices oscillate enough that strict rank-based replacement causes constituents to swap in/out month-over-month. To prevent this:

- An existing constituent is **only removed** if it falls below **rank #40** in the trailing 90-day dollar volume ranking.
- A non-constituent enters the index when an existing constituent drops out, taking the next-highest qualifying card by rank.
- If multiple constituents fall below #40 in the same period, replacements are filled in dollar-volume rank order.

This means the 25 constituents are not always the literal top 25 — they are the top 25 *with persistence*. A card that ranks #26-#39 stays in. A card that ranks #1-#25 but is currently a non-constituent does **not** force its way in; it waits for an existing member to fall to #40.

## 6. Per-card price (daily)

The daily reference price for each constituent is the **7-day trimmed mean of eBay PSA 10 sold listings**.

### Computation

1. Collect all eBay completed/sold listings tagged PSA 10 for the constituent in the trailing 7 days.
2. Drop the top 10% and bottom 10% of sales by price (eliminates shill bids and broken/joke listings).
3. Take the arithmetic mean of the remaining sales.

### Sample size fallback

If fewer than 5 sales in 7 days, fall back in order:

1. Extend to 14-day window.
2. Extend to 30-day window.
3. If still <5 sales, use last good price with a **0.5%/day decay penalty** toward the prior 30-day mean until fresh data arrives. The constituent is flagged stale but is **not** ejected mid-month — ejection only happens at scheduled rebalance.

## 7. Index value

The index is computed daily as:

```
I_t = 1000 × (1/25) × Σ_{i=1..25} (P_{i,t} / P_{i,base})
```

Where:
- `P_{i,t}` is the trimmed-mean daily price of constituent `i` on day `t`.
- `P_{i,base}` is the constituent's price at its most recent rebase (inception or rebalance).
- The index is **chain-linked** at each rebalance: new constituents enter at index-neutral weight, so a swap does not create an artificial jump in index value.

Inception value is 1000.

## 8. Manipulation defenses

| Vector | Defense |
|---|---|
| Wash trading a single card to spike index | 7-day window means ~5 days sustained shill required; 10% trim kills outlier sales |
| Pumping a marginal card to sneak into Top 25 | Dollar-volume selection (not count) requires large capital; 90-day window dampens short-term volume bursts |
| Front-running monthly rebalance | 7-day pre-announcement is public; perp position limits (defined in perp engine spec) cap any single trader's exposure to index moves |
| Stale data exploitation | Decay penalty on stale constituents shifts price toward 30-day mean, removing the manipulator's anchor |
| Cross-grader arbitrage (e.g., CGC 10 pretending to be PSA 10) | PSA-only rule; oracle publishers filter listing titles for "PSA 10" |

## 9. Edge cases

### 9.1 Pokemon Center stamped variants

Cards bearing a Pokemon Center stamp (or any other distribution-channel stamp such as Prerelease, Staff, World Championships) are **separate constituents** from their unstamped base prints. They share the (set, collector number) but have a distinct `variant` code (e.g., `PC` suffix on the variant). Stamped variants typically will not pass the eligibility filters individually due to lower sale volumes and population — the methodology does not aggregate them with the base print.

### 9.2 Parallel mini-set numbering (Trainer Gallery / Galarian Gallery)

Cards from parallel mini-sets within a main set (e.g., Brilliant Stars Trainer Gallery TG01–TG30, Lost Origin Trainer Gallery TG01–TG30, Crown Zenith Galarian Gallery GG01–GG70) use their mini-set number as the canonical collector number. They are independent constituents from any same-Pokemon card in the main set.

Example: `Charizard TG03/TG30 (Lost Origin Trainer Gallery)` is a distinct constituent from `Charizard 011/196 (Lost Origin main set)`.

Publishers must include the mini-set prefix (TG, GG) in the canonical search string for these constituents.

### 9.3 SAR/SIR over-numbered cards (title-matching logic)

Special Illustration Rare (SIR) and Special Art Rare (SAR) cards are numbered above the base set's total card count — for example, `199/165` in Pokemon 151 (where the base set is 165 cards). eBay listing titles for these cards vary widely: some sellers use `199/165`, some use just `199`, some use the base number with a variant keyword, some omit the number entirely.

Publisher listing-match logic MUST accept a listing if **any** of the following is true:

1. The listing title contains the full SAR/SIR number with the full set total (e.g., `"199/165"`).
2. The listing title contains the SAR/SIR number alone (e.g., `"199"`) AND a variant keyword (`SIR`, `SAR`, `special illustration`, `special art`, `alt art`, `secret rare`).
3. The listing title contains the variant keyword AND the constituent's exact Pokemon name (e.g., `"Charizard ex"`) AND the set name (`"151"` or `"Scarlet & Violet 151"`).

This redundancy ensures real-world listing-title variation does not cause the publisher to miss legitimate sales.

### 9.4 Reprints across sets

A card with the same Pokemon and similar artwork in a later set is a different constituent. Examples: Charizard VMAX from Champion's Path (74/73) is distinct from Charizard VMAX from Darkness Ablaze (20/189). The (set, collector number, variant) tuple is authoritative.

### 9.5 PSA grade flips

Irrelevant to PMT25. Only PSA 10 sales are priced. A card cracked from a PSA 9 slab and resubmitted as a PSA 10 enters the PSA 10 supply pool but the prior grade is not tracked by the methodology.

### 9.6 Card delisted by eBay or pulled by PSA

Triggers off-cycle rebalance via publisher consensus (oracle spec §9). Replacement is the next-highest qualifying card per trailing 90-day dollar volume.

### 9.7 eBay API outage or data source compromise

Publishers vote to declare a data emergency (oracle spec §9). Index frozen at last value; perp funding paused per perp engine spec.

### 9.8 Constituent registry as authoritative identity

The on-chain constituent registry stores each constituent as a (set, collector number, variant) tuple plus a canonical eBay search string. Publishers must match each candidate listing to a registry entry via:

1. **Collector number match**: the listing's collector number matches the registry's, allowing for both `x/y` and bare `x` formats. Numbering ambiguity (e.g., `211` vs `212` for Sylveon V vs Sylveon VMAX alt art) is resolved by requiring the variant keyword in step 3.
2. **Set match**: the listing's set name matches the registry's, allowing for common abbreviations (`"151"` ↔ `"Pokemon 151"` ↔ `"Scarlet & Violet 151"`; `"BS"` ↔ `"Brilliant Stars"`).
3. **Variant match**: the listing's variant keyword matches the registry's variant code (`alt art`, `secret rare`, `rainbow rare`, `SIR`, `SAR`, `Rainbow Rare`, `Trainer Gallery`, etc.).

A listing matching only 2 of these 3 conditions is **excluded** from the trimmed-mean computation. The registry is the source of truth — publisher-side heuristics cannot expand a constituent's identity.

## 10. Transparency commitments

- This methodology document is published on-chain via content hash; updates require a versioned bump and 7-day public notice.
- Daily per-constituent prices, sale counts, and the resulting index value are posted on-chain.
- Monthly rebalance provisional lists and final lists are published in a public repository with the ranking computation reproducible from raw eBay data.

---

## Open questions for v0.3

Resolved in v0.2: PSA 10 qualifier handling (§1, §3), English-only language rule (§1, §3), Pokemon Center stamped variants (§9.1), Trainer Gallery / Galarian Gallery numbering (§9.2), SAR/SIR title-matching (§9.3), constituent registry matching protocol (§9.8). Oracle publisher set composition is covered in [oracle.md](./oracle.md).

Remaining open:

- **Companion indices**: a "Pokeperp Vintage 25" (pre-2014) and a "Japanese Modern Top 25" are both plausible second products. Both deferred until v1 mainnet is stable and the publisher set has demonstrated reliable operation for ≥6 months.
- **Pokemon Center stamp re-aggregation**: methodology v0.2 treats stamps as separate constituents that almost always won't qualify. Should a future version aggregate stamped + unstamped under one constituent with publisher-weighted price blending? Tentative answer: no — keeps the index simpler and the secondary stamps trade at a premium that would distort the base print's price signal — but flagging for future review if stamp markets grow.
- **Backtesting feasibility**: simulate PMT25 over the past 12–24 months from historical eBay sold-listings data to validate that the index produces sensible behavior across past market regimes. The hard part is sourcing historical eBay data — Marketplace Insights API has limited lookback, and scraping retroactively is unreliable.
- **Sub-index slicing**: should the index expose subsidiary indices (e.g., "PMT25 Eeveelution sub-index", "PMT25 Charizard sub-index") that traders can take separate perp exposure on? Adds product complexity; defer until v1 has shown organic demand for differentiated exposure.
- **Variant-level granularity for Charizard**: Charizard appears in many constituents (Brilliant Stars V AA, Brilliant Stars VSTAR Rainbow, Lost Origin Trainer Gallery, Pokemon 151 SIR, Obsidian Flames SIR, Champion's Path VMAX Rainbow, etc.). Should there be an explicit cap on the number of same-Pokemon constituents to avoid Pokemon-level concentration? Not in v1 — equal weighting and a 25-card limit already cap any single Pokemon at 25% — but worth revisiting if a future verified ranking shows Charizard exceeding 35-40% of constituents.
