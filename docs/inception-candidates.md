# Inception Constituents — Candidate List

**Version:** 0.1 (PMT25 inception, historical)
**Status:** Historical — superseded by the PMT50 expansion (v0.10, May 2026)
**Last updated:** 2026-05-19

> **Historical note (v0.10):** This document is the **original PMT25**
> inception list — the 25 cards used to bootstrap the index at launch.
> The v0.10 expansion added a further 25 cards (PMT26-50) selected from
> real Oxylabs scrape data of 90-day eBay sold dollar volume; see
> `services/dashboard/scripts/scrape-50-candidates.ts` and the seed
> array in `services/dashboard/scripts/init-localnet.ts` /
> `services/dashboard/scripts/expand-to-50.ts` for the live PMT50 list.
> The structural reasoning below still applies; the constituent count
> and rebalance buffer (rank #75, not #40) are the only methodology
> changes.

**Depends on:** [methodology.md](./methodology.md)

This document proposes the original inception 25 constituents for what
was then the PSA 10 Modern Top 25 (PMT25) index based on knowledge of
the modern Pokemon TCG market.

---

## Verification status (extended, 2026-05-19)

A multi-source verification pass against Pokeval, Card-Codex, Card Ladder, Sports Card Investor, and aggregated search results on 2026-05-19 produced 17 hard-verified PSA 10 prices out of 25 candidates, plus 6 set/numbering corrections and 6 still-unverified holdouts.

### Headline finding

**The modern PSA 10 alt-art market has rerated 2-13× higher than the initial §2 estimates.** Umbreon is the *only* verified card that did not move materially; everything else has rallied substantially. The §2 ranking by dollar volume is therefore materially out of date, and the inception roster will look meaningfully different from the §2 candidate list.

### Verified PSA 10 prices (17 cards)

| Card | §2 est | Verified PSA 10 | Multiple | Source |
|---|---|---|---|---|
| Umbreon VMAX 215/203 AA (Evolving Skies) | $1,400 | $1,450 (range $1,200-$1,800) | 1.0× | Pokeval |
| Rayquaza VMAX 218/203 AA (Evolving Skies) | $280 | $2,825 (last sold 2026-05-14) | 10.1× | Card Ladder |
| Lugia V 186/195 AA (Silver Tempest) | $380 | $1,593 (+30.7% 30d) | 4.2× | Card-Codex |
| Giratina V 186/196 AA (Lost Origin) | $360 | $3,085 (+10.5% 30d) | 8.6× | Card-Codex |
| Charizard ex 199/165 SIR (Pokemon 151) | $380 | $1,781 (+3.7% 30d) | 4.7× | Card-Codex |
| Espeon V 180/203 AA (Evolving Skies) | $160 | $574 (+29.6% 30d) | 3.6× | Card-Codex |
| Leafeon V 167/203 AA (Evolving Skies) | $130 | $319 (+15.9% 30d) | 2.5× | Card-Codex |
| Charizard V 154/172 AA (Brilliant Stars) | $190 | $958 (+5.3% 30d) | 5.0× | Card-Codex |
| Charizard VMAX 74/73 Rainbow (Champion's Path) | $420 | $394 (+12.2% 30d) | 0.94× | Card-Codex |
| Charizard VSTAR 174/172 Rainbow (Brilliant Stars) | $240 | $229 (+3.9% 30d) | 0.95× | Card-Codex |
| Pikachu VMAX 188/185 Rainbow (Vivid Voltage) | $180 | $399 (+18.7% 30d) | 2.2× | Card-Codex |
| Mew V 251/264 AA (Fusion Strike) † | $200 | $494 (+9.9% 30d) | 2.5× | Card-Codex |
| Reshiram & Charizard GX 217/214 Rainbow (Unbroken Bonds) | $240 | $655 (+4.7% 30d) | 2.7× | Card-Codex |
| Mewtwo & Mew GX 242/236 Rainbow (Unified Minds) † | $250 | $1,245 (+40.5% 30d) | 5.0× | Card-Codex |
| Charizard TG03/TG30 Trainer Gallery (Lost Origin) † | $150 | $393 (+48.2% 30d) | 2.6× | Card-Codex |
| Gengar VMAX 271/264 AA (Fusion Strike) | $210 | $2,761 (+16.3% 30d) | 13.1× | Card-Codex |
| Mew VMAX 269/264 AA (Fusion Strike) | $310 | $592 (+27.7% 30d) | 1.9× | Card-Codex |

† indicates a card with a corrected number or set vs. §2 (see Corrections below).

### Corrections to §2 candidate list

| §2 entry | Actual identity |
|---|---|
| Mew V — Fusion Strike — 268/264 | Mew V — Fusion Strike — **251/264** |
| Mewtwo & Mew GX — Unified Minds — 244/236 | Mewtwo & Mew GX — Unified Minds — **242/236** |
| Charizard ex — Obsidian Flames — 199/197 SIR | The "199/197 SIR" verification I cited in v0.1 was actually **Pokemon 151's** Charizard ex 199/165, not Obsidian Flames. Obsidian Flames Charizard ex SIR is a separate card (likely 215/197 or 223/197) — **still unverified.** |
| Trainer Gallery Charizard — Brilliant Stars — TG03/TG30 | Trainer Gallery Charizard is from **Lost Origin** TG03/TG30. Brilliant Stars' TG03 is **Octillery**. |
| Gardevoir ex — Paldean Fates — 245/091 SAR | Gardevoir ex SIR is **233/091** (eBay PSA 10 listings confirm) — still unverified for price. |
| Sylveon V — Evolving Skies — 211/203 AA | The 211/203 numbering may refer to Sylveon VMAX, not Sylveon V. Card-Codex returns 404 for both V and VMAX at this number under standard rarity slugs. Identity needs disambiguation. |

### Still unverified (6 cards)

- Sylveon V AA (Evolving Skies) — number disambiguation needed
- Glaceon V AA 169/203 (Evolving Skies) — 404 on Card-Codex
- Hisuian Zoroark VSTAR 188/189 AA (Astral Radiance) — 404 on Card-Codex; note Crown Zenith has a parallel reprint at GG56/GG70 that may have higher volume
- Gardevoir ex SIR 233/091 (Paldean Fates) — 404 on Card-Codex
- Charizard ex SIR (Obsidian Flames) — need to identify correct number (215/197 vs 223/197) before lookup
- Charizard VMAX SV107/SV122 Shiny Vault (Shining Fates) — search returned PSA 6 sold at $288 but no clean PSA 10 number

Partial / asking-price only:
- Iono SAR 269/193 (Paldea Evolved): ~$150-225 asking range
- Giovanni's Charisma SIR 204/165 (Pokemon 151): $160 retail

### Revised provisional ranking (top 10 by est dollar volume, verified prices × est sale counts)

| Rank | Card | Verified price × est 90d sales = est $ volume |
|---|---|---|
| 1 | Rayquaza VMAX 218/203 AA | $2,825 × 1,150 ≈ $3.25M |
| 2 | Giratina V 186/196 AA | $3,085 × 950 ≈ $2.93M |
| 3 | Charizard ex 199/165 SIR (151) | $1,781 × 1,500 ≈ $2.67M |
| 4 | Umbreon VMAX 215/203 AA | $1,450 × 1,500 ≈ $2.18M |
| 5 | Gengar VMAX 271/264 AA | $2,761 × 750 ≈ $2.07M |
| 6 | Lugia V 186/195 AA | $1,593 × 950 ≈ $1.51M |
| 7 | Charizard V 154/172 AA (Brilliant Stars) | $958 × 1,150 ≈ $1.10M |
| 8 | Mewtwo & Mew GX 242/236 Rainbow | $1,245 × 750 ≈ $0.93M |
| 9 | Reshiram & Charizard GX 217/214 Rainbow | $655 × 750 ≈ $0.49M |
| 10 | Mew VMAX 269/264 AA | $592 × 900 ≈ $0.53M |

**Note:** sale counts above are still §2 estimates, not verified. A real ranking pass must verify volume (90-day sold count) from eBay alongside price, since some cards may have lower volume than I assumed.

### Key implications

1. **Several §2 high-ranked cards drop dramatically.** Charizard VMAX Rainbow (Champion's Path), which I had ranked #3, lands outside the top 10 — supply has caught up and prices have plateaued. Iono SAR and Giovanni's Charisma (#10, #9) drop out of top 15 entirely at their verified retail prices.

2. **Several §2 low-ranked cards surge.** Gengar VMAX AA (#17 → #5), Mewtwo & Mew GX (#13 → #8), Espeon V AA (#19 → mid-tier strong). Cards I omitted entirely (e.g., Sylveon VMAX AA at ~$510) may belong in the top 25.

3. **Umbreon is not "the king" anymore.** Multiple cards now trade above Umbreon's $1,450 average. Rayquaza, Giratina, Gengar VMAX, Charizard ex 151, Lugia V are all >$1,500 PSA 10.

4. **30-day momentum is high across the board.** Most verified cards show +5% to +48% in 30 days. This is a market in active appreciation, not consolidation — index volatility will be high in early operation.

5. **The methodology itself held up unchanged.** No methodology revision needed.

### Mandatory verification gates before inception

These must run via the publisher pipeline on the actual inception day:

- **Price**: live eBay trimmed-mean PSA 10 sold prices for every candidate (this verification used Card-Codex aggregations, which lag eBay by hours-to-days).
- **Volume**: 90-day eBay sold count per card (only Umbreon was volume-verified in this pass).
- **PSA population**: PSA's public pop report (only Umbreon was pop-verified).
- **Disambiguation**: numbering and set assignments for the 6 corrections above.
- **Re-rank**: produce final 25 from the cleaned data, not from this document.

### Recommendation

§2 is a *structural illustration* of how the methodology selects an index, not the launch roster. The §2 table should be retained for documentation but explicitly marked "non-binding". The inception roster is produced by the publisher pipeline (oracle spec §3) running real eBay queries on the day of inception.

---

## 1. Selection summary

All candidates satisfy methodology §3 eligibility filters:

| Filter | Threshold | All candidates compliant? |
|---|---|---|
| Era | Released ≥ Feb 1, 2014 (XY onward) | Yes |
| Set release age | ≥180 days old as of 2026-05-19 (released on/before 2025-11-20) | Yes |
| PSA 10 sales (trailing 90d) | ≥50 | Yes (estimated) |
| PSA population | ≥100 | Yes (estimated) |
| Card type | Not error/misprint/signed/sealed/serialized | Yes |

Ranking is by **estimated trailing 90-day eBay PSA 10 sold dollar volume**.

## 2. Candidate constituents (ranked)

| # | Card | Set | Variant | Est. PSA 10 price (USD) | Est. 90d sales | Est. 90d $ volume |
|---|---|---|---|---|---|---|
| 1 | Umbreon VMAX | Evolving Skies | 215/203 (Alt Art) | $1,400 | 800 | $1,120,000 |
| 2 | Charizard | Pokemon 151 | 199/165 (Alt Art) | $380 | 1,500 | $570,000 |
| 3 | Charizard VMAX | Champion's Path | 074/073 (Rainbow Rare) | $420 | 1,000 | $420,000 |
| 4 | Lugia V | Silver Tempest | 186/195 (Alt Art) | $380 | 950 | $361,000 |
| 5 | Giratina V | Lost Origin | 186/196 (Alt Art) | $360 | 950 | $342,000 |
| 6 | Rayquaza VMAX | Evolving Skies | 218/203 (Alt Art) | $280 | 1,150 | $322,000 |
| 7 | Charizard ex | Obsidian Flames | 199/197 (Special Illustration Rare) | $260 | 1,200 | $312,000 |
| 8 | Mew VMAX | Fusion Strike | 269/264 (Alt Art) | $310 | 900 | $279,000 |
| 9 | Giovanni's Charisma | Pokemon 151 | 204/165 | $240 | 1,100 | $264,000 |
| 10 | Iono | Paldea Evolved | 269/193 (Special Art Rare) | $220 | 1,100 | $242,000 |
| 11 | Charizard V | Brilliant Stars | 154/172 (Alt Art) | $190 | 1,150 | $218,500 |
| 12 | Charizard VSTAR | Brilliant Stars | 174/172 (Rainbow Rare) | $240 | 850 | $204,000 |
| 13 | Mewtwo & Mew GX | Unified Minds | 244/236 (Rainbow Rare) | $250 | 750 | $187,500 |
| 14 | Reshiram & Charizard GX | Unbroken Bonds | 217/214 (Rainbow Rare) | $240 | 750 | $180,000 |
| 15 | Pikachu VMAX | Vivid Voltage | 188/185 (Rainbow Rare) | $180 | 950 | $171,000 |
| 16 | Mew V | Fusion Strike | 268/264 (Alt Art) | $200 | 800 | $160,000 |
| 17 | Gengar VMAX | Fusion Strike | 271/264 (Alt Art) | $210 | 750 | $157,500 |
| 18 | Charizard VMAX | Shining Fates | SV107/SV122 (Shiny Vault) | $200 | 750 | $150,000 |
| 19 | Espeon V | Evolving Skies | 180/203 (Alt Art) | $160 | 900 | $144,000 |
| 20 | Sylveon V | Evolving Skies | 211/203 (Alt Art) | $150 | 900 | $135,000 |
| 21 | Gardevoir ex | Paldean Fates | 245/091 (Special Art Rare) | $170 | 750 | $127,500 |
| 22 | Leafeon V | Evolving Skies | 167/203 (Alt Art) | $130 | 900 | $117,000 |
| 23 | Glaceon V | Evolving Skies | 169/203 (Alt Art) | $130 | 850 | $110,500 |
| 24 | Charizard (Pokemon Trainer Gallery) | Brilliant Stars | TG03/TG30 | $150 | 700 | $105,000 |
| 25 | Hisuian Zoroark VSTAR | Astral Radiance | 188/189 (Alt Art) | $130 | 750 | $97,500 |

**Estimated total trailing 90-day dollar volume across the 25**: ~$6.3M
**Estimated mean PSA 10 price** (equal-weighted): ~$310
**Estimated median PSA 10 price**: $210

## 3. Set distribution

| Set | Constituents | Notes |
|---|---|---|
| Evolving Skies (2021) | 6 (Umbreon VMAX AA, Rayquaza VMAX AA, Espeon V AA, Sylveon V AA, Leafeon V AA, Glaceon V AA) | Evolving Skies dominates modern; this is realistic. Concentration risk flagged in §5. |
| Pokemon 151 (2023) | 2 | High recent volume |
| Brilliant Stars (2022) | 3 | Charizard saturation |
| Fusion Strike (2021) | 3 | Mew + Gengar alt arts |
| Champion's Path (2020) | 1 | Charizard VMAX Rainbow |
| Silver Tempest (2022) | 1 | Lugia V AA |
| Lost Origin (2022) | 1 | Giratina V AA |
| Obsidian Flames (2023) | 1 | Charizard ex SIR |
| Paldea Evolved (2023) | 1 | Iono |
| Paldean Fates (2024) | 1 | Gardevoir ex SAR |
| Vivid Voltage (2020) | 1 | Pikachu VMAX Rainbow |
| Shining Fates (2021) | 1 | Charizard VMAX SV |
| Unified Minds (2019) | 1 | Mewtwo & Mew GX |
| Unbroken Bonds (2019) | 1 | Reshiram & Charizard GX |
| Astral Radiance (2022) | 1 | Hisuian Zoroark VSTAR |

### Pokemon distribution

- **Charizard**: 8 constituents (Pokemon 151 AA, Champion's Path VMAX Rainbow, Obsidian Flames SIR, Brilliant Stars V AA, Brilliant Stars VSTAR Rainbow, Shining Fates VMAX SV, Brilliant Stars TG, Unbroken Bonds Reshiram & Charizard GX)
- **Eeveelutions**: 5 (Umbreon VMAX AA, Espeon V AA, Sylveon V AA, Leafeon V AA, Glaceon V AA)
- **Mythicals/Legendaries**: 7 (Mew VMAX AA, Mew V AA, Mewtwo & Mew GX, Lugia V AA, Giratina V AA, Rayquaza VMAX AA, Hisuian Zoroark VSTAR)

This is reflective of the actual modern market: Charizard and Eevee variants dominate dollar volume. The methodology does not require Pokemon-level diversification, so concentration is acceptable.

## 4. Inception index value math

Per methodology §7:

```
I_inception = 1000 × (1/25) × Σ (P_i,t / P_i,base) = 1000  (by construction at t = base)
```

The inception value is 1000 by definition; ratios start at 1.0. The numbers in §2 only matter for ranking (selecting the 25) and for setting `P_{i,base}` values used in subsequent calculations.

## 5. Concentration risks flagged

1. **Evolving Skies represents 6/25 (24%) of constituents.** Equal weighting limits the financial concentration to 24% of index value, but ES is structurally dominant in modern. If ES specifically experiences a re-grading event, set damage discovery, or PSA pop revision, the index moves disproportionately. Risk acknowledged; equal weighting is the defense.

2. **Charizard appears in 7/25 (28%) of constituents.** Same defense — equal weighting caps the financial impact at 28%, but a "Charizard winter" (price drop across all Charizard cards simultaneously) would still hit the index hard.

3. **No card from 2024 or later qualifies under the 180-day filter as of inception.** Once Paldean Fates (Jan 2024), Twilight Masquerade (May 2024), Shrouded Fable, Stellar Crown, Surging Sparks, Prismatic Evolutions all age into eligibility, the index will refresh substantially in the first 6 months. **This is a feature, not a bug** — the methodology is designed to track market evolution — but expect heavy turnover in the first 3-6 monthly rebalances.

4. **Older cards (2019 Unbroken Bonds, Unified Minds)**: these may have declining volume; verify they still meet the 50-sales/90d floor at verification time.

## 6. Verification plan (REQUIRED before launch)

The following must be completed before this list is locked as the inception roster:

### Step 1: Price verification

For each candidate, pull the trailing 7-day trimmed-mean PSA 10 sold price from:

- eBay completed-listings search via Browse API (or scrape with manual review)
- Cross-reference with PriceCharting PSA 10 column
- Cross-reference with 130point recent sales

Acceptance: all three sources agree within ±10% of each other.

### Step 2: Volume verification

For each candidate, count PSA 10 sold transactions on eBay in the trailing 90 days. Cross-reference with PriceCharting volume estimates if available.

Acceptance: ≥50 PSA 10 sales (methodology §3).

### Step 3: Population verification

Pull PSA population counts from PSA's public population report.

Acceptance: ≥100 PSA 10s (methodology §3).

### Step 4: Re-rank

Re-compute trailing 90-day dollar volume using verified prices and counts. Re-sort. The top 25 may be different from this candidate list — the methodology is what's authoritative, this document is a starting hypothesis.

### Step 5: Variant disambiguation

Each constituent's `(set, collector number, variant)` tuple needs to be unambiguous on-chain. For variant codes:

- Standard rare: `R`
- Alt Art: `AA`
- Special Illustration Rare: `SIR`
- Rainbow Rare: `RR`
- Shiny Vault: `SV`
- Trainer Gallery: `TG`
- Special Art Rare: `SAR`

The constituent registry account (on-chain) will store this tuple plus a canonical eBay search string per constituent.

## 7. Edge cases surfaced by this list

> **Status: all five resolved in [methodology.md](./methodology.md) v0.2.** The subsections below preserve the original framing for historical context; each now points to the resolving rule.

These are issues the candidate roster surfaced that aren't fully resolved in methodology v0.1:

### 7.1 Pokemon Center vs base print

Some Charizard cards have Pokemon Center exclusive variants (different stamp, different artwork pattern). The methodology says "variant" but doesn't enumerate stamp types. **Resolution needed**: explicit rule on whether Pokemon Center stamped cards are a separate constituent or aggregated with the base print.

### 7.2 Numbering ambiguity in Special Art Rares

Modern sets use parallel numbering for SARs/SIRs (e.g., 199/197 means "card 199 in a set with 197 base cards"). eBay listings sometimes use the base number, sometimes the SAR number, sometimes both. **Resolution needed**: publishers' fuzzy-match rules must explicitly handle this — likely "match if either the base or SAR number appears in the title with the variant keyword".

### 7.3 Trainer Gallery / Galarian Gallery cards

Brilliant Stars (Trainer Gallery) and Crown Zenith (Galarian Gallery) have parallel "mini-sets" with their own numbering. The Trainer Gallery Charizard is `TG03/TG30`, not a number within the main 172-card Brilliant Stars set. The methodology assumes "set + number" uniquely identifies a card — confirmed it does, but publishers must include the TG/GG prefix in their canonical search string.

### 7.4 Japanese-language equivalents

Methodology §10 flagged this as open. Several candidates (Umbreon VMAX, Lugia V AA) have Japanese counterparts that trade at different prices. v1 decision should be: **only English-language PSA 10s count.** Add this rule explicitly to methodology v0.2.

### 7.5 PSA 10 with "qualifier" labels

PSA sometimes adds qualifiers (OC = off-center, ST = staining, etc.) to a PSA 10 grade. These are technically still PSA 10 but trade at a discount. **Resolution needed**: methodology should specify "PSA 10 only, no qualifiers". Publishers should filter for clean PSA 10 listings.

## 8. Open questions for v0.2

- **Refresh cadence of this candidate list**: this document will be regenerated and re-verified at every monthly rebalance. Should the regeneration be automated (script ingests eBay data, outputs ranked list) or remain a manual operations task?
- **Inception timing**: should we wait for Prismatic Evolutions (released late 2024 / early 2025?) to age into the 180-day window before launching, since it dramatically reshapes the modern market?
- **Backtesting**: can we reconstruct what PMT25 would have looked like at monthly snapshots over the past 12-24 months, to sanity-check that the index produces sensible behavior? This would require historical eBay sold-listing data which is hard to obtain.
