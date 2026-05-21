# Publisher Service Design

**Version:** 0.1
**Status:** Draft
**Last updated:** 2026-05-19
**Depends on:** [methodology.md](./methodology.md), [oracle.md](./oracle.md)

The Pokeperp publisher service is the off-chain agent that fetches eBay PSA 10 sold-listings data, applies the methodology rules, and submits a signed `PriceUpdate` account to the on-chain oracle program once per day. This document specifies its architecture, configuration, source interface, methodology application, observability, and operational expectations.

Each of the 3-5 federated publishers (see [oracle.md](./oracle.md) §2) runs an independent instance of this service. The reference implementation in `services/publisher/` is open-source; publishers are not required to use it but their submissions must be consistent with the rules below.

---

## 1. Goals

- Produce a daily 25-element price array and 25-element sale-count array that conform exactly to methodology §6.
- Independence: each publisher can choose its own data sources (eBay APIs, scraping, third-party aggregators) and combine them. The on-chain submission is what's consensus-checked, not the path to it.
- Reproducibility: the merkle root of source listings allows post-hoc audit of any specific sale used in trimmed-mean computation.
- Operate unattended: a publisher runs the daily routine on a schedule with retries, alerts, and observability. No human in the loop on the happy path.
- Cheap to run: a Solana RPC, an eBay API key, and ~$5/mo of compute should be enough.

## 2. Architecture

```
                              ┌─────────────────────────────────────┐
                              │  Publisher service (this crate)     │
                              │                                     │
                              │   ┌───────────────────────┐         │
                              │   │  Scheduler            │         │
                              │   │  (cron / systemd      │         │
                              │   │   timer / k8s job)    │         │
                              │   └─────────┬─────────────┘         │
                              │             ▼                       │
   ┌─────────────────┐        │   ┌───────────────────────┐         │
   │  eBay APIs      │◀───────┤───┤  Sources              │         │
   │  PriceCharting  │        │   │  (trait + per-source  │         │
   │  130point       │        │   │   impls)              │         │
   │  Card Ladder    │        │   └─────────┬─────────────┘         │
   └─────────────────┘        │             ▼                       │
                              │   ┌───────────────────────┐         │
                              │   │  Methodology          │         │
                              │   │  (filter, trim,       │         │
                              │   │   fallback windows)   │         │
                              │   └─────────┬─────────────┘         │
                              │             ▼                       │
                              │   ┌───────────────────────┐         │
                              │   │  Merkle              │          │
                              │   │  (build source root)  │         │
                              │   └─────────┬─────────────┘         │
                              │             ▼                       │
                              │   ┌───────────────────────┐         │
                              │   │  Submit               │         │
                              │   │  (sign + send tx)     │         │
                              │   └─────────┬─────────────┘         │
                              │             ▼                       │
                              └─────────────┼───────────────────────┘
                                            ▼
                              ┌─────────────────────────┐
                              │  Solana oracle program  │
                              │  (PriceUpdate account)  │
                              └─────────────────────────┘
```

**Modules:**

| Module | Responsibility |
|---|---|
| `config` | Parse `publisher.toml`; load keypair |
| `sources` | Trait `PriceSource`; one impl per data path (eBay, PriceCharting, etc.) |
| `methodology` | Apply per-listing filters (§3 publisher side); compute trimmed mean with fallback windows |
| `merkle` | Build the 32-byte source root over `(listing_id, price_microusdc, sold_at_unix)` leaves |
| `submit` | Construct, sign, and send the `submit_price_update` transaction |
| `main` | CLI: `run`, `dry-run`, `backfill`, `verify` subcommands |

## 3. Daily workflow

The submission window per [oracle.md](./oracle.md) §4 is 20:00–23:59 UTC. The default schedule fires at 22:00 UTC with retries until 23:30 UTC.

```
22:00 UTC ┌─ Load config and constituent registry from chain
          │
22:00 UTC ├─ For each constituent (25):
          │     1. Query each configured source for trailing 7-day PSA 10 sold listings
          │     2. Apply publisher-side filters (PSA 10 only, English, no qualifier,
          │        shipping anomaly, blacklist) per oracle.md §3
          │     3. Compute trimmed mean (drop top/bottom 10%, mean of remainder)
          │     4. If sample <5: extend window to 14d, then 30d, then mark stale
          │     5. Record (listing_id, price_microusdc, sold_at_unix) leaves
          │
22:05 UTC ├─ Build merkle root over all leaves
          │
22:05 UTC ├─ Construct PriceUpdate instruction with:
          │      day = unix_day_of(target_date)
          │      prices = [u64; 25]   (micro-USDC)
          │      sale_counts = [u16; 25]
          │      source_root = [u8; 32]
          │
22:05 UTC ├─ Sign with publisher keypair, send via RPC
          │
22:05 UTC ├─ Confirm transaction landed, log signature
          │
22:05 UTC └─ Emit metrics: per-constituent price, sample size, source breakdown
```

## 4. Configuration

`publisher.toml` shape:

```toml
[identity]
publisher_keypair_path = "/etc/pokeperp/publisher.json"
publisher_pubkey = "PubKey..."     # cross-check against keypair

[oracle]
rpc_url = "https://api.mainnet-beta.solana.com"
oracle_program_id = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"
commitment = "confirmed"

[methodology]
trim_top_pct = 10
trim_bottom_pct = 10
min_sample_size = 5
window_days_primary = 7
window_days_fallback = [14, 30]
stale_decay_pct_per_day = 0.5

[sources]
primary = "ebay_browse"
secondary = ["pricecharting", "card_ladder"]

[sources.ebay_browse]
app_id = "${EBAY_APP_ID}"
cert_id = "${EBAY_CERT_ID}"
rate_limit_rpm = 100

[sources.pricecharting]
api_key = "${PRICECHARTING_API_KEY}"

[sources.card_ladder]
api_key = "${CARDLADDER_API_KEY}"

[schedule]
submit_at_utc_hour = 22
submit_at_utc_minute = 0
retry_max_attempts = 3
retry_backoff_seconds = 300

[observability]
metrics_port = 9100
log_level = "info"
log_format = "json"

[security]
allow_dry_run_only = false        # if true, never submits; for staging
require_sample_count_consistency = true   # error if sources disagree on count >20%
```

Environment variables are resolved with `${VAR}` syntax.

## 5. The `PriceSource` trait

```rust
#[async_trait]
pub trait PriceSource: Send + Sync {
    /// Fetch sold listings for a single constituent over a window.
    async fn fetch_listings(
        &self,
        constituent: &Constituent,
        window: TimeWindow,
    ) -> Result<Vec<SoldListing>>;

    /// Source identifier for telemetry / merkle leaf source field.
    fn name(&self) -> &'static str;
}

pub struct SoldListing {
    pub listing_id: String,      // source-specific listing ID
    pub price_microusdc: u64,    // observed price in micro-USDC
    pub sold_at_unix: i64,       // sale completion timestamp
    pub source: String,          // name of source that produced this leaf
    pub raw_title: String,       // original listing title (for filter audit)
    pub buyer_hash: Option<[u8; 32]>,   // hashed buyer ID for blacklist match
    pub seller_hash: Option<[u8; 32]>,
}
```

**Reference implementations to provide (stub-grade in v0.1):**

- `ebay_browse` — eBay Browse API with `filter=soldItems` parameter
- `ebay_marketplace_insights` — partner-only, deeper window
- `pricecharting` — third-party aggregator API
- `card_ladder` — third-party with PSA-graded sale focus

Publishers may add their own; the trait is stable.

## 6. Methodology application (publisher-side)

Strictly mirrors [methodology.md](./methodology.md) §6 + [oracle.md](./oracle.md) §3.

```
fn compute_constituent_price(
    listings: Vec<SoldListing>,
    constituent: &Constituent,
    config: &MethodologyConfig,
    blacklist: &Blacklist,
) -> Result<ConstituentResult> {
    // 1. Apply mandatory filters
    let filtered: Vec<_> = listings
        .into_iter()
        .filter(|l| title_contains_psa_10_clean(&l.raw_title))     // no qualifiers
        .filter(|l| title_is_english(&l.raw_title))                // English only
        .filter(|l| variant_matches(&l.raw_title, &constituent.variant_code))
        .filter(|l| !buyer_blacklisted(l, blacklist))
        .filter(|l| !seller_blacklisted(l, blacklist))
        .filter(|l| shipping_ratio_ok(l))                          // drop shipping anomalies
        .collect();

    // 2. Sample size fallback chain
    let (final_listings, window_used) = apply_fallback_windows(filtered, config)?;

    if final_listings.len() < config.min_sample_size {
        return Ok(ConstituentResult::Stale {
            decayed_price: apply_decay(constituent.base_price, days_since_fresh()),
        });
    }

    // 3. Trim top/bottom 10%
    let mut prices: Vec<u64> = final_listings.iter().map(|l| l.price_microusdc).collect();
    prices.sort_unstable();
    let trim_count = (prices.len() * config.trim_top_pct as usize) / 100;
    let trimmed = &prices[trim_count..prices.len() - trim_count];

    // 4. Arithmetic mean of trimmed window
    let mean = (trimmed.iter().sum::<u64>() / trimmed.len() as u64);

    Ok(ConstituentResult::Computed {
        price_microusdc: mean,
        sample_count: final_listings.len() as u16,
        window_used,
        leaves: final_listings,
    })
}
```

## 7. Merkle source root

Per [oracle.md](./oracle.md) §4, the `PriceUpdate.source_root` is a 32-byte hash that lets anyone audit which listings backed the day's price. Structure:

- Leaves are `sha256(constituent_index || listing_id || price_microusdc || sold_at_unix || source_name)`
- Tree is a binary Merkle tree, leaves ordered by (constituent_index, listing_id)
- Root is the top hash, written as `[u8; 32]` to the `PriceUpdate` account

Publishers store the full leaf list off-chain (in a public S3 bucket or IPFS) for audit. When challenged (oracle.md §6), they produce the Merkle proof for the disputed leaf.

## 8. Submission flow

```rust
async fn submit(
    client: &RpcClient,
    program: &Program,
    keypair: &Keypair,
    day: u32,
    prices: [u64; 25],
    sale_counts: [u16; 25],
    source_root: [u8; 32],
) -> Result<Signature> {
    let publisher_pda = derive_publisher_pda(&keypair.pubkey());
    let price_update_pda = derive_price_update_pda(&keypair.pubkey(), day);

    let ix = program
        .request()
        .accounts(SubmitPriceUpdate {
            publisher: keypair.pubkey(),
            publisher_account: publisher_pda,
            price_update: price_update_pda,
            system_program: system_program::ID,
        })
        .args(args::SubmitPriceUpdate { day, prices, sale_counts, source_root })
        .signer(keypair)
        .send_with_options(SendOptions {
            commitment: CommitmentConfig::confirmed(),
            skip_preflight: false,
            max_retries: 3,
        })
        .await?;

    Ok(ix)
}
```

Retry policy:
- Transient RPC errors → exponential backoff (60s, 300s, 900s)
- Transaction error (e.g., `DuplicateSubmission`) → log + alert, no retry
- Window closed before successful submission → alert, mark publisher missed-submission

## 9. Observability

**Metrics (Prometheus, port 9100):**

| Metric | Type | Description |
|---|---|---|
| `pokeperp_publisher_submissions_total{result="success\|fail"}` | counter | Submission outcomes |
| `pokeperp_publisher_listings_fetched{source="..."}` | counter | Per-source fetch counts |
| `pokeperp_publisher_constituent_sample_size{constituent="N"}` | gauge | Sample size per constituent |
| `pokeperp_publisher_constituent_price_microusdc{constituent="N"}` | gauge | Computed price per constituent |
| `pokeperp_publisher_constituent_stale{constituent="N"}` | gauge | 1 if constituent fell to stale fallback |
| `pokeperp_publisher_window_used_days{constituent="N"}` | gauge | 7, 14, or 30 |

**Logs (JSON via `tracing`):**

```json
{
  "ts": "2026-05-19T22:05:13Z",
  "level": "info",
  "event": "constituent_priced",
  "constituent_index": 0,
  "price_microusdc": 1450000000,
  "sample_count": 247,
  "window_days": 7,
  "trim_dropped": 49,
  "sources": ["ebay_browse", "pricecharting"]
}
```

**Health check (HTTP GET /health):**
- 200 if last successful submission was within 30 hours
- 500 otherwise, with last-error in body

## 10. Operations

### Deployment

Recommended: containerized (Docker image), deployed as a systemd timer / k8s CronJob fired at 22:00 UTC daily. Keep instance running for metrics scraping between fires.

### Key management

- Publisher keypair: keep in a hardware-backed signer (Ledger, YubiHSM) for mainnet. File-based keypair acceptable for devnet.
- Bond vault: separate keypair, owned by the on-chain program PDA — publisher never touches it directly.
- Source API keys: in environment variables, sourced from a secrets manager (Doppler, 1Password Connect, AWS Secrets Manager).

### Backfill mode

`pokeperp-publisher backfill --from 2026-05-01 --to 2026-05-15` computes (but does not submit) historical days for verification and for reproducing publisher behavior after a dispute. Output is a structured JSON per day matching the on-chain submission format.

### Dry-run mode

`pokeperp-publisher run --dry-run` performs all steps except the final on-chain submission. Used for staging and for the publisher shadow period (oracle.md §2).

### Verify mode

`pokeperp-publisher verify --day 19500` re-runs the day's computation locally and compares the result to what was submitted on-chain. Returns deviation per constituent and the merkle root match status. Used by challengers and auditors.

## 11. Security model

A publisher is trusted to:

- Faithfully apply the methodology (verified post-hoc via merkle root + verify mode).
- Protect its signing key (compromise = bond at risk + reputational removal).
- Operate reliably during the submission window (liveness slashing per oracle.md §7).

A publisher is **not** trusted with:

- Solana vault custody (bond is held by program PDA).
- Sole price authority (median of 3+ publishers gates aggregation).

Threats and mitigations:

| Threat | Mitigation |
|---|---|
| Source API compromise | Multiple sources required; outlier source detection |
| Coordinated publisher collusion | Multi-publisher set; staked challenge mechanism (oracle.md §6) |
| Single-publisher key compromise | Single submission max-impact bounded by median aggregation |
| Methodology drift | Verify mode + open-source publisher + merkle audit trail |

## 12. Open questions for v0.2

- **Multi-source aggregation strategy**: when a publisher uses both eBay Browse + PriceCharting, should they combine before trim, or compute per-source and take median? Lean toward combine-before-trim — more samples = tighter trimmed mean.
- **eBay rate limiting**: Browse API allows ~5,000 calls/day under the basic tier. With 25 constituents × 4 sources × 7-day pages, a publisher could blow through this. Need caching + day-incremental fetching.
- **Listing deduplication across sources**: if PriceCharting scrapes eBay, the publisher might double-count the same sale. Dedup by `(listing_id, sold_at)` tuple before trim.
- **Source-of-truth for buyer/seller hashes**: blacklist requires hashed identifiers. eBay obfuscates buyer IDs publicly. Need a strategy for stable buyer-ID hashing.
- **Failover between publishers**: if a publisher misses submission, does another publisher trigger a "stand-in" submission, or is the system tolerant of one missing submission (since 3-of-5 is the floor)? Current design: tolerant (no stand-in), but consider mutual-monitoring publishers.
