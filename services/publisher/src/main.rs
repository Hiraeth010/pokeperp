//! Pokeperp publisher service.
//!
//! Fetches PSA 10 prices for the 50 PMT50 constituents, applies the methodology,
//! and submits a signed PriceUpdate to the on-chain oracle. Two pricing paths are
//! supported via `[sources] primary`:
//!
//! - `"drift"` (v0.2 default): deterministically perturb on-chain base_price by ±2%.
//!   Useful for localnet/staging where no real source credentials are available.
//! - `"ebay_browse"`: real eBay Browse sold-items search per constituent, then
//!   methodology pipeline (filter → fallback windows → trimmed mean). Source root
//!   is a real merkle over the leaves actually used.
//!
//! Spec: docs/publisher.md (architecture), docs/methodology.md §6 (trimming),
//! docs/oracle.md §4 (submission format).

mod config;
mod merkle;
mod methodology;
mod sources;
mod state;
mod submit;

use anyhow::{anyhow, Context, Result};
use clap::{Parser, Subcommand};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair, Signer},
};
use std::str::FromStr;
use tracing::{info, warn};

use crate::methodology::MethodologyConfig;
use crate::sources::{
    AggregatePriceSource, ConstituentQuery, PriceSource, SoldListing, TimeWindow,
};
use crate::state::{state_path_for_config, PublisherState};
use crate::submit::{SubmitParams, CONSTITUENT_COUNT};

#[derive(Parser)]
#[command(name = "pokeperp-publisher", version)]
struct Cli {
    /// Path to publisher.toml.
    #[arg(long, default_value = "publisher.toml")]
    config: String,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Fetch listings, apply methodology, submit PriceUpdate.
    Run {
        /// Compute everything but skip the on-chain submission.
        #[arg(long)]
        dry_run: bool,
        /// Override the day to submit FOR (defaults to current_unix_day - 1).
        #[arg(long)]
        day: Option<u32>,
    },
    /// Run on a daily schedule (sleep until submit_at_utc_hour:minute, then submit, then loop).
    Daemon,
    /// Poll every `interval_secs`; submit + aggregate for current_day-1 whenever
    /// that day isn't already done. Idempotent no-op otherwise. Built for an
    /// always-on host (Railway): it reacts to each UTC-midnight rollover within
    /// one interval and retries a failed cycle on the next tick. Unlike `daemon`,
    /// this also calls `aggregate_day` — the index actually advances.
    Crank {
        /// Poll interval in seconds.
        #[arg(long, default_value_t = 60)]
        interval_secs: u64,
    },
    /// Re-run a day's price computation locally and compare to the on-chain
    /// PriceUpdate already submitted by this publisher. Reports per-slot deviation
    /// (basis points) and source-root match. Non-zero exit on any disagreement.
    /// Use this for post-hoc audit after a challenge or to gate a publisher upgrade.
    Verify {
        /// Day to verify. PriceUpdate at PDA seeds [b"price", publisher_pubkey, day_le]
        /// must already exist on-chain.
        #[arg(long)]
        day: u32,
        /// Allowed per-slot deviation in basis points before the verify is treated
        /// as failed. Drift mode should produce zero deviation; eBay mode tolerates
        /// some noise from non-deterministic API responses across runs.
        #[arg(long, default_value_t = 0)]
        tolerance_bps: u32,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();
    let cfg = config::load(&cli.config).with_context(|| format!("loading {}", cli.config))?;

    // PublisherState lives next to publisher.toml. Tracks per-constituent
    // last-fresh-day for the stale-decay fallback. Verify doesn't touch state
    // (read-only path); Run + Daemon load + save around each cycle.
    let state_path = state_path_for_config(std::path::Path::new(&cli.config));

    match cli.command {
        Command::Run { dry_run, day } => {
            let mut state = PublisherState::load(&state_path)
                .with_context(|| format!("loading state at {}", state_path.display()))?;
            info!(
                tracked_slots = state.last_fresh_day.len(),
                "loaded publisher state"
            );
            let result = run_daily(&cfg, dry_run, day, &mut state).await;
            // Persist any state mutations (fresh-day bumps) even on partial
            // failure — slots that succeeded before the error still recorded
            // useful progress.
            if let Err(e) = state.save(&state_path) {
                warn!(error = ?e, "failed to save publisher state");
            } else {
                info!(path = %state_path.display(), "saved publisher state");
            }
            result
        }
        Command::Daemon => daemon_loop(&cfg, &state_path).await,
        Command::Crank { interval_secs } => crank_loop(&cfg, &state_path, interval_secs).await,
        Command::Verify { day, tolerance_bps } => verify_day(&cfg, day, tolerance_bps).await,
    }
}

/// One submission cycle: read on-chain state, compute prices, submit.
/// Load the publisher signing keypair. Prefers the `PUBLISHER_KEYPAIR_JSON` env
/// var — the standard Solana keypair byte array as JSON, exactly what
/// `solana-keygen` / the `*.json` keypair files contain — so a deployment can
/// inject the key as a secret instead of baking a file into the image. Falls
/// back to `identity.publisher_keypair_path` from the config for local dev where
/// the keypair lives on disk.
fn load_publisher_keypair(cfg: &config::Config) -> Result<Keypair> {
    if let Ok(json) = std::env::var("PUBLISHER_KEYPAIR_JSON") {
        let json = json.trim();
        if !json.is_empty() {
            let bytes: Vec<u8> = serde_json::from_str(json).context(
                "parsing PUBLISHER_KEYPAIR_JSON (expected a JSON array of bytes, \
                 like a solana-keygen keypair file)",
            )?;
            return Keypair::from_bytes(&bytes)
                .map_err(|e| anyhow!("PUBLISHER_KEYPAIR_JSON is not a valid keypair: {e}"));
        }
    }
    read_keypair_file(&cfg.identity.publisher_keypair_path)
        .map_err(|e| anyhow!("read keypair {}: {}", cfg.identity.publisher_keypair_path, e))
}

async fn run_daily(
    cfg: &config::Config,
    dry_run: bool,
    day_override: Option<u32>,
    state: &mut PublisherState,
) -> Result<()> {
    let oracle_program_id = Pubkey::from_str(&cfg.oracle.oracle_program_id)
        .context("parsing oracle.oracle_program_id")?;
    let client = RpcClient::new_with_commitment(
        cfg.oracle.rpc_url.clone(),
        CommitmentConfig::confirmed(),
    );

    let keypair = load_publisher_keypair(cfg)?;
    let publisher_pubkey = keypair.pubkey();
    info!(publisher = %publisher_pubkey, "loaded keypair");

    let (registry_pda, _) =
        Pubkey::find_program_address(&[b"registry"], &oracle_program_id);
    let registry_data = client
        .get_account_data(&registry_pda)
        .context("fetch ConstituentRegistry account")?;
    let constituents = parse_registry(&registry_data).context("parse ConstituentRegistry")?;

    let current_day = (chrono::Utc::now().timestamp() / 86_400) as u32;
    let day = day_override.unwrap_or(current_day - 1);
    info!(day, current_day, primary = %cfg.sources.primary, "computing prices");

    let (prices, sale_counts, source_root) = match cfg.sources.primary.as_str() {
        // "registry_drift" is the legacy name from the v0.2 localnet config.
        "drift" | "registry_drift" => compute_drift(day, &constituents),
        "ebay_browse" => {
            compute_from_ebay(cfg, day, &constituents, state)
                .await
                .context("compute_from_ebay")?
        }
        "scraper" => {
            compute_from_scraper(cfg, day, &constituents, state)
                .await
                .context("compute_from_scraper")?
        }
        other => {
            return Err(anyhow!(
                "unknown [sources] primary: {:?} (expected 'drift', 'ebay_browse', or 'scraper')",
                other
            ));
        }
    };

    info!(
        slot0 = prices[0],
        slot1 = prices[1],
        slot2 = prices[2],
        "computed prices (first 3)"
    );

    if dry_run {
        info!("dry-run: skipping submission");
        return Ok(());
    }

    let sig = submit::submit(
        &client,
        &oracle_program_id,
        &keypair,
        SubmitParams {
            day,
            prices,
            sale_counts,
            source_root,
        },
    )?;
    info!(%sig, day, "submitted PriceUpdate");
    Ok(())
}

/// Daily-loop wrapper: sleep until the configured UTC hour:minute, submit, then loop.
async fn daemon_loop(cfg: &config::Config, state_path: &std::path::Path) -> Result<()> {
    info!(
        hour = cfg.schedule.submit_at_utc_hour,
        minute = cfg.schedule.submit_at_utc_minute,
        "starting publisher daemon"
    );
    // Load once at startup; persist after every cycle.
    let mut state = PublisherState::load(state_path)
        .with_context(|| format!("loading state at {}", state_path.display()))?;
    loop {
        let sleep_secs = seconds_until_next(
            cfg.schedule.submit_at_utc_hour,
            cfg.schedule.submit_at_utc_minute,
        );
        info!(sleep_secs, "next submission in");
        tokio::time::sleep(std::time::Duration::from_secs(sleep_secs)).await;
        match run_daily(cfg, false, None, &mut state).await {
            Ok(()) => info!("submission ok"),
            Err(e) => warn!(error = ?e, "submission failed; will retry next cycle"),
        }
        if let Err(e) = state.save(state_path) {
            warn!(error = ?e, "failed to save publisher state");
        }
    }
}

/// Poll loop: every `interval_secs`, ensure `current_day - 1` is submitted and
/// aggregated, then sleep. Each step is guarded by an on-chain existence check,
/// so a tick where the day is already done is a cheap no-op (two `getAccount`
/// reads). The expensive scrape only runs on the first tick after a UTC-midnight
/// rollover; a cycle that fails partway is retried on the next tick.
async fn crank_loop(
    cfg: &config::Config,
    state_path: &std::path::Path,
    interval_secs: u64,
) -> Result<()> {
    let oracle_program_id = Pubkey::from_str(&cfg.oracle.oracle_program_id)
        .context("parsing oracle.oracle_program_id")?;
    let keypair = load_publisher_keypair(cfg)?;
    let publisher_pubkey = keypair.pubkey();
    info!(
        interval_secs,
        publisher = %publisher_pubkey,
        rpc = %cfg.oracle.rpc_url,
        "starting publisher crank (poll + act-on-rollover)"
    );

    let mut state = PublisherState::load(state_path)
        .with_context(|| format!("loading state at {}", state_path.display()))?;

    loop {
        match crank_cycle(cfg, &oracle_program_id, &keypair, publisher_pubkey, &mut state).await {
            Ok(()) => {}
            Err(e) => warn!(error = ?e, "crank cycle failed; retrying next interval"),
        }
        if let Err(e) = state.save(state_path) {
            warn!(error = ?e, "failed to save publisher state");
        }
        tokio::time::sleep(std::time::Duration::from_secs(interval_secs)).await;
    }
}

/// One crank tick: submit for `current_day - 1` if this publisher hasn't yet,
/// then aggregate that day if the on-chain IndexState isn't already on it.
async fn crank_cycle(
    cfg: &config::Config,
    oracle_program_id: &Pubkey,
    keypair: &solana_sdk::signature::Keypair,
    publisher_pubkey: Pubkey,
    state: &mut PublisherState,
) -> Result<()> {
    let client = RpcClient::new_with_commitment(
        cfg.oracle.rpc_url.clone(),
        CommitmentConfig::confirmed(),
    );
    let current_day = (chrono::Utc::now().timestamp() / 86_400) as u32;
    let target_day = current_day - 1;

    // 1. Submit if this publisher hasn't submitted for target_day yet. The
    //    PriceUpdate PDA is unique per (publisher, day), so its existence is the
    //    submission marker (and a re-submit would hit DuplicateSubmission).
    let pu_pda = submit::price_update_pda(oracle_program_id, &publisher_pubkey, target_day);
    if client.get_account(&pu_pda).is_err() {
        info!(day = target_day, "no submission for target day — scraping + submitting");
        run_daily(cfg, false, Some(target_day), state)
            .await
            .context("run_daily (submit)")?;
    } else {
        info!(day = target_day, "submission already present");
    }

    // 2. Aggregate if the IndexState isn't already on target_day. aggregate_day
    //    is permissionless, so the publisher keypair pays. Single-publisher
    //    devnet: the only submission to fold in is our own PriceUpdate.
    let (index_state_pda, _) =
        Pubkey::find_program_address(&[b"index_state"], oracle_program_id);
    let index_day = read_index_day(&client, &index_state_pda);
    if index_day != Some(target_day) {
        info!(day = target_day, ?index_day, "aggregating target day");
        let sig =
            submit::aggregate_day(&client, oracle_program_id, keypair, target_day, &[pu_pda])?;
        info!(%sig, day = target_day, "aggregated");
    } else {
        info!(day = target_day, "index already current — nothing to do");
    }
    Ok(())
}

/// Read `IndexState.day` (u32 at byte offset 8, right after the 8-byte Anchor
/// discriminator). Returns `None` if the account doesn't exist yet or is too
/// short to parse.
fn read_index_day(client: &RpcClient, index_state_pda: &Pubkey) -> Option<u32> {
    let data = client.get_account_data(index_state_pda).ok()?;
    let bytes: [u8; 4] = data.get(8..12)?.try_into().ok()?;
    Some(u32::from_le_bytes(bytes))
}

/// Re-run a day's price computation locally and compare to the on-chain submission.
///
/// Steps:
///   1. Read the existing PriceUpdate at PDA seeds=[b"price", publisher_pubkey, day_le].
///      This is the artifact the publisher submitted earlier; we re-derive it here.
///   2. Locally re-compute prices via the same `[sources] primary` path used by Run.
///   3. Compare per-slot prices (basis-point deviation), sale counts, and the
///      source merkle root.
///   4. Exit non-zero if any slot exceeds `tolerance_bps` OR the root mismatches.
///
/// In drift mode the computation is deterministic — zero tolerance is correct. In
/// ebay_browse mode the same eBay API hit run a day later may return slightly
/// different aggregates (a sale rolled out of the window, new sales in); allow a
/// few basis points there via `--tolerance-bps`.
async fn verify_day(cfg: &config::Config, day: u32, tolerance_bps: u32) -> Result<()> {
    let oracle_program_id = Pubkey::from_str(&cfg.oracle.oracle_program_id)
        .context("parsing oracle.oracle_program_id")?;
    let client = RpcClient::new_with_commitment(
        cfg.oracle.rpc_url.clone(),
        CommitmentConfig::confirmed(),
    );

    let keypair = load_publisher_keypair(cfg)?;
    let publisher_pubkey = keypair.pubkey();
    info!(publisher = %publisher_pubkey, day, "verifying");

    // Pull on-chain artifacts.
    let (registry_pda, _) =
        Pubkey::find_program_address(&[b"registry"], &oracle_program_id);
    let registry_data = client
        .get_account_data(&registry_pda)
        .context("fetch ConstituentRegistry account")?;
    let constituents = parse_registry(&registry_data).context("parse ConstituentRegistry")?;

    let (price_update_pda, _) = Pubkey::find_program_address(
        &[b"price", publisher_pubkey.as_ref(), &day.to_le_bytes()],
        &oracle_program_id,
    );
    let pu_data = client.get_account_data(&price_update_pda).with_context(|| {
        format!(
            "PriceUpdate not found at {} — nothing was submitted for (publisher={}, day={})",
            price_update_pda, publisher_pubkey, day
        )
    })?;
    let submitted = parse_price_update(&pu_data).context("parse PriceUpdate")?;

    info!(
        submitted_publisher = %submitted.publisher,
        submitted_day = submitted.day,
        "fetched on-chain submission"
    );
    if submitted.publisher != publisher_pubkey {
        return Err(anyhow!(
            "PriceUpdate.publisher ({}) does not match local keypair ({})",
            submitted.publisher,
            publisher_pubkey
        ));
    }
    if submitted.day != day {
        return Err(anyhow!(
            "PriceUpdate.day ({}) does not match requested day ({})",
            submitted.day,
            day
        ));
    }

    // Local re-computation via the same path Run uses. Verify is intentionally
    // stateless — uses a throwaway default PublisherState so the on-disk state
    // file isn't mutated by an audit run.
    let mut verify_state = PublisherState::default();
    let (local_prices, local_sale_counts, local_root) = match cfg.sources.primary.as_str() {
        "drift" | "registry_drift" => compute_drift(day, &constituents),
        "ebay_browse" => compute_from_ebay(cfg, day, &constituents, &mut verify_state)
            .await
            .context("compute_from_ebay")?,
        "scraper" => compute_from_scraper(cfg, day, &constituents, &mut verify_state)
            .await
            .context("compute_from_scraper")?,
        other => {
            return Err(anyhow!(
                "unknown [sources] primary: {:?} (expected 'drift', 'ebay_browse', or 'scraper')",
                other
            ));
        }
    };

    // Per-slot comparison.
    let tolerance_bps_i = tolerance_bps as i64;
    let mut max_dev_bps: i64 = 0; // overall max — informational
    let mut drift_count: u32 = 0; // count exceeding tolerance — actionable
    for i in 0..CONSTITUENT_COUNT {
        let sub = submitted.prices[i];
        let loc = local_prices[i];
        let sub_sc = submitted.sale_counts[i];
        let loc_sc = local_sale_counts[i];
        let deviation_bps = if sub == 0 {
            if loc == 0 { 0 } else { 99999 } // sub==0 should never happen (handler rejects)
        } else {
            (((loc as i128) - (sub as i128)) * 10_000 / sub as i128) as i64
        };
        let abs_dev = deviation_bps.unsigned_abs() as i64;
        if abs_dev > max_dev_bps {
            max_dev_bps = abs_dev;
        }
        let drifted = abs_dev > tolerance_bps_i;
        if drifted {
            drift_count += 1;
            warn!(
                slot = i,
                submitted_price = sub,
                local_price = loc,
                submitted_sale_count = sub_sc,
                local_sale_count = loc_sc,
                deviation_bps,
                "DRIFT"
            );
        } else {
            info!(
                slot = i,
                submitted_price = sub,
                local_price = loc,
                deviation_bps,
                "ok"
            );
        }
    }

    let root_match = submitted.source_root == local_root;
    info!(
        submitted_root = %hex_encode(&submitted.source_root),
        local_root = %hex_encode(&local_root),
        match_ = root_match,
        "source_root"
    );

    if drift_count > 0 || !root_match {
        return Err(anyhow!(
            "verify FAILED: {drift_count}/{CONSTITUENT_COUNT} slot(s) drifted (max {max_dev_bps} bps, tolerance {tolerance_bps} bps); source_root match = {root_match}"
        ));
    }
    info!(
        slots_checked = CONSTITUENT_COUNT,
        max_dev_bps,
        "✓ verify OK — all slots within tolerance, source_root matches"
    );
    Ok(())
}

/// Decoded on-chain `PriceUpdate` (oracle::state::PriceUpdate, declaration-order
/// borsh layout under Anchor's 8-byte discriminator).  Offsets parameterised by
/// `CONSTITUENT_COUNT = N` so flipping N keeps the layout consistent:
///   offset  0.. 8:                   discriminator
///   offset  8..40:                   publisher (Pubkey)
///   offset 40..44:                   day (u32 LE)
///   offset 44 .. 44+8N:              prices ([u64; N] LE)
///   offset 44+8N .. 44+8N+2N:        sale_counts ([u16; N] LE)
///   offset 44+10N .. 44+10N+32:      source_root ([u8; 32])
///   offset 44+10N+32 .. 44+10N+40:   submitted_at (i64 LE)
///   offset 44+10N+40:                bump (u8)
struct SubmittedPriceUpdate {
    publisher: Pubkey,
    day: u32,
    prices: [u64; CONSTITUENT_COUNT],
    sale_counts: [u16; CONSTITUENT_COUNT],
    source_root: [u8; 32],
}

fn parse_price_update(data: &[u8]) -> Result<SubmittedPriceUpdate> {
    const PUBLISHER_OFF: usize = 8;
    const DAY_OFF: usize = 40;
    const PRICES_OFF: usize = 44;
    const SALE_COUNTS_OFF: usize = PRICES_OFF + CONSTITUENT_COUNT * 8;
    const SOURCE_ROOT_OFF: usize = SALE_COUNTS_OFF + CONSTITUENT_COUNT * 2;
    const MIN_LEN: usize = SOURCE_ROOT_OFF + 32;
    if data.len() < MIN_LEN {
        return Err(anyhow!(
            "PriceUpdate account too short: {} bytes (need >= {})",
            data.len(),
            MIN_LEN
        ));
    }
    let publisher = Pubkey::try_from(&data[PUBLISHER_OFF..PUBLISHER_OFF + 32])
        .map_err(|_| anyhow!("publisher slice into Pubkey"))?;
    let day = u32::from_le_bytes(
        data[DAY_OFF..DAY_OFF + 4]
            .try_into()
            .map_err(|_| anyhow!("day slice"))?,
    );
    let mut prices = [0u64; CONSTITUENT_COUNT];
    for i in 0..CONSTITUENT_COUNT {
        let off = PRICES_OFF + i * 8;
        prices[i] = u64::from_le_bytes(
            data[off..off + 8]
                .try_into()
                .map_err(|_| anyhow!("price[{i}] slice"))?,
        );
    }
    let mut sale_counts = [0u16; CONSTITUENT_COUNT];
    for i in 0..CONSTITUENT_COUNT {
        let off = SALE_COUNTS_OFF + i * 2;
        sale_counts[i] = u16::from_le_bytes(
            data[off..off + 2]
                .try_into()
                .map_err(|_| anyhow!("sale_count[{i}] slice"))?,
        );
    }
    let mut source_root = [0u8; 32];
    source_root.copy_from_slice(&data[SOURCE_ROOT_OFF..SOURCE_ROOT_OFF + 32]);
    Ok(SubmittedPriceUpdate {
        publisher,
        day,
        prices,
        sale_counts,
        source_root,
    })
}

/// Tiny lowercase hex without pulling the `hex` crate in.
fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn seconds_until_next(hour: u32, minute: u32) -> u64 {
    let now = chrono::Utc::now();
    let today_target = now
        .date_naive()
        .and_hms_opt(hour, minute, 0)
        .map(|nt| nt.and_utc())
        .unwrap_or(now);
    let next = if today_target > now {
        today_target
    } else {
        today_target + chrono::Duration::days(1)
    };
    (next - now).num_seconds().max(0) as u64
}

/// One constituent parsed from the registry account (a host-side mirror of the
/// on-chain `Constituent` struct).
#[derive(Debug, Clone)]
struct ConstituentInfo {
    base_price: u64,
    set_code: String,
    variant_code: String,
    collector_number: u16,
    set_total: u16,
}

impl ConstituentInfo {
    /// Construct the eBay search query for this constituent.
    ///
    /// First tries `curated_query()` — a hand-built table mapping each known
    /// (set_code, collector_number, variant) to a query that sellers actually
    /// use ("Pokemon Giratina V Lost Origin 186 Alt Art PSA 10") instead of
    /// our internal abbreviations.  Falls back to a generic
    /// "Pokemon {set_code} {n}/{set_total} {variant_word} PSA 10" if the slot
    /// isn't in the curated table — that's noisy but doesn't crash.
    ///
    /// NB: changing this function detaches the search query from the
    /// `canonical_search_hash` stored on-chain in the Constituent registry.
    /// The on-chain hash is metadata only — it's not validated by
    /// `submit_price_update`, so the divergence is cosmetic.  A future
    /// registry update could re-hash these curated strings to bring them
    /// back in sync, but it's not strictly required for correct operation.
    fn search_string(&self) -> String {
        if let Some(curated) = curated_query(
            &self.set_code,
            self.collector_number,
            &self.variant_code,
        ) {
            return curated;
        }
        self.generic_search_string()
    }

    /// Generic fallback when the curated table doesn't cover this slot.
    fn generic_search_string(&self) -> String {
        let variant_word = match self.variant_code.to_ascii_uppercase().as_str() {
            "AA" => "Alt Art",
            "SIR" => "SIR",
            "SAR" => "SAR",
            "RR" | "RAINBOW" => "Rainbow Rare",
            "TG" => "Trainer Gallery",
            "GG" => "Galarian Gallery",
            "VMAX" => "VMAX",
            "VSTAR" => "VSTAR",
            _ => "",
        };
        let mut s = String::from("Pokemon");
        if !self.set_code.is_empty() {
            s.push(' ');
            s.push_str(&self.set_code);
        }
        s.push(' ');
        s.push_str(&format!("{}/{}", self.collector_number, self.set_total));
        if !variant_word.is_empty() {
            s.push(' ');
            s.push_str(variant_word);
        }
        s.push_str(" PSA 10");
        s
    }
}

/// Hand-curated map from (registry set_code, collector_number, variant) to an
/// eBay-friendly search query.  Mirrors the CARD_NAMES table in
/// services/dashboard/lib/cards.ts; sources for these queries are
/// docs/inception-candidates.md §2 (verified prices were obtained against
/// listings matching these queries).
///
/// Format convention: "Pokemon <Card Name> <Set Name> <number> <variant words> PSA 10".
/// We omit the "/<set_total>" suffix because most sellers don't include it,
/// and including it filters out many otherwise-matching listings.  Methodology
/// downstream rejects anything without "PSA 10" + matching variant keyword,
/// so the over-broad search doesn't actually pull in noise.
fn curated_query(set_code: &str, collector_number: u16, variant_code: &str) -> Option<String> {
    let key = (set_code, collector_number, variant_code.to_ascii_uppercase());
    let s = match (key.0, key.1, key.2.as_str()) {
        // ----- Evolving Skies (swsh7) -----
        ("ES", 215, "AA") => "Pokemon Umbreon VMAX Evolving Skies 215 Alt Art PSA 10",
        ("ES", 218, "AA") => "Pokemon Rayquaza VMAX Evolving Skies 218 Alt Art PSA 10",
        ("ES", 180, "AA") => "Pokemon Espeon V Evolving Skies 180 Alt Art PSA 10",
        ("ES", 167, "AA") => "Pokemon Leafeon V Evolving Skies 167 Alt Art PSA 10",
        ("ES", 184, "AA") => "Pokemon Sylveon V Evolving Skies 184 Alt Art PSA 10",
        ("ES", 175, "AA") => "Pokemon Glaceon V Evolving Skies 175 Alt Art PSA 10",
        // ----- Lost Origin (swsh11) -----
        ("LO", 186, "AA") => "Pokemon Giratina V Lost Origin 186 Alt Art PSA 10",
        ("LO", 3, "TG")   => "Pokemon Charizard Trainer Gallery Lost Origin TG03 PSA 10",
        // ----- Silver Tempest (swsh12) -----
        ("ST", 186, "AA") => "Pokemon Lugia V Silver Tempest 186 Alt Art PSA 10",
        // ----- Brilliant Stars (swsh9) -----
        ("BS", 154, "AA") => "Pokemon Charizard V Brilliant Stars 154 Alt Art PSA 10",
        ("BS", 174, "RR") => "Pokemon Charizard VSTAR Brilliant Stars 174 Rainbow Rare PSA 10",
        // ----- Champion's Path (swsh35) -----
        ("CP", 74, "RR")  => "Pokemon Charizard VMAX Champion's Path 74 Rainbow Rare PSA 10",
        // ----- Vivid Voltage (swsh4) -----
        ("VV", 188, "RR") => "Pokemon Pikachu VMAX Vivid Voltage 188 Rainbow Rare PSA 10",
        // ----- Fusion Strike (swsh8) -----
        ("FS", 251, "AA") => "Pokemon Mew V Fusion Strike 251 Alt Art PSA 10",
        ("FS", 269, "AA") => "Pokemon Mew VMAX Fusion Strike 269 Alt Art PSA 10",
        ("FS", 271, "AA") => "Pokemon Gengar VMAX Fusion Strike 271 Alt Art PSA 10",
        // ----- Unbroken Bonds (sm10) -----
        ("UB", 217, "RR") => "Pokemon Reshiram Charizard GX Unbroken Bonds 217 Rainbow Rare PSA 10",
        // ----- Unified Minds (sm11) -----
        ("UM", 242, "RR") => "Pokemon Mewtwo Mew GX Unified Minds 242 Rainbow Rare PSA 10",
        // ----- Pokemon 151 (sv3pt5) -----
        ("PMK", 199, "SIR") => "Pokemon Charizard ex 151 199 Special Illustration Rare PSA 10",
        ("PMK", 204, "SIR") => "Pokemon Giovanni's Charisma 151 204 Special Illustration Rare PSA 10",
        // ----- Astral Radiance / Crown Zenith Galarian Gallery -----
        // Registry has this slot as AR-188-AA but Astral Radiance #188 is
        // actually Roxanne SAR — the real Hisuian Zoroark VSTAR alt art lives
        // in Crown Zenith's Galarian Gallery subset as GG56.  Override the
        // search to find the card we actually want.
        ("AR", 188, "AA") => "Pokemon Hisuian Zoroark VSTAR Crown Zenith GG56 PSA 10",
        // ----- Obsidian Flames (sv3) -----
        ("OF", 215, "SIR") => "Pokemon Charizard ex Obsidian Flames 215 Special Illustration Rare PSA 10",
        // ----- Paldean Fates (sv4pt5) -----
        ("PaF", 233, "SIR") => "Pokemon Gardevoir ex Paldean Fates 233 Special Illustration Rare PSA 10",
        // ----- Paldea Evolved (sv2) -----
        ("PE", 269, "SAR") => "Pokemon Iono Paldea Evolved 269 Special Art Rare PSA 10",
        // ----- Shining Fates Shiny Vault (swsh45sv) -----
        ("SF", 107, "RR") => "Pokemon Charizard VMAX Shining Fates Shiny Vault SV107 PSA 10",

        // ====== PMT26-50 (v0.10 expansion; (set, num, variant) match the
        //         on-chain registry as of 2026-05-30 mainnet cutover) ======

        // slot 25 — Silver Tempest, Lugia VSTAR Alt Art (distinct from ST-186 Lugia V)
        ("ST", 211, "AA")  => "Pokemon Lugia VSTAR Silver Tempest 211 Alt Art PSA 10",

        // slot 26 — Pokemon 151, regular Pikachu Illustration Rare (the surfer)
        //   Originally listed as Pikachu ex SIR but that card doesn't exist;
        //   pointed at sv3pt5-173 which is the well-known Pikachu IR.
        ("PMK", 173, "SIR") => "Pokemon Pikachu Pokemon 151 173 Illustration Rare PSA 10",

        // slots 27-29 — Pokemon 151 SIR ex chase cards
        ("PMK", 200, "SIR") => "Pokemon Blastoise ex Pokemon 151 200 Special Illustration Rare PSA 10",
        ("PMK", 198, "SIR") => "Pokemon Venusaur ex Pokemon 151 198 Special Illustration Rare PSA 10",
        ("PMK", 201, "SIR") => "Pokemon Alakazam ex Pokemon 151 201 Special Illustration Rare PSA 10",

        // slot 30 — Pokemon 151, Mew ex SIR (sv3pt5-193 is the real SIR, NOT 205)
        ("PMK", 193, "SIR") => "Pokemon Mew ex Pokemon 151 193 Special Illustration Rare PSA 10",

        // slot 31 — Lost Origin, Giratina VSTAR Alt Art (swsh11-212, NOT 213)
        ("LO", 212, "AA")  => "Pokemon Giratina VSTAR Lost Origin 212 Alt Art PSA 10",

        // slot 32 — Surging Sparks, Pikachu ex SIR
        ("SS", 238, "SIR") => "Pokemon Pikachu ex Surging Sparks 238 Special Illustration Rare PSA 10",

        // slot 33 — Twilight Masquerade, Bloodmoon Ursaluna ex SIR
        //   (substituted for non-existent Pikachu V-UNION CEL-25-UN)
        ("TM", 216, "SIR") => "Pokemon Bloodmoon Ursaluna ex Twilight Masquerade 216 Special Illustration Rare PSA 10",

        // slots 34-36 — Crown Zenith Galarian Gallery, real chase cards
        //   (substituted for non-existent Charizard VSTAR / Pikachu VMAX / Rayquaza VMAX GG variants)
        ("CZ", 44, "GG")   => "Pokemon Mewtwo VSTAR Crown Zenith Galarian Gallery GG44 PSA 10",
        ("CZ", 50, "GG")   => "Pokemon Darkrai VSTAR Crown Zenith Galarian Gallery GG50 PSA 10",
        ("CZ", 51, "GG")   => "Pokemon Hisuian Samurott V Crown Zenith Galarian Gallery GG51 PSA 10",

        // slot 37 — Twilight Masquerade, Greninja ex SIR
        //   (substituted for non-existent Zacian V CZ-51-GG)
        ("TM", 214, "SIR") => "Pokemon Greninja ex Twilight Masquerade 214 Special Illustration Rare PSA 10",

        // slot 38 — Astral Radiance, Origin Palkia VSTAR Alt Art (swsh10-208, NOT 211)
        ("AR", 208, "AA")  => "Pokemon Origin Forme Palkia VSTAR Astral Radiance 208 Alt Art PSA 10",

        // slot 39 — Astral Radiance, Origin Dialga VSTAR Alt Art (swsh10-210, NOT 209)
        ("AR", 210, "AA")  => "Pokemon Origin Forme Dialga VSTAR Astral Radiance 210 Alt Art PSA 10",

        // slot 40 — Hisuian Goodra V is actually in Lost Origin (swsh11-187), NOT Astral Radiance.
        //   Note: on-chain set_code moved from "AR" to "LO" here.
        ("LO", 187, "AA")  => "Pokemon Hisuian Goodra V Lost Origin 187 Alt Art PSA 10",

        // slot 41 — Brilliant Stars, Arceus VSTAR Alt Art
        ("BS", 184, "AA")  => "Pokemon Arceus VSTAR Brilliant Stars 184 Alt Art PSA 10",

        // slot 42 — Stellar Crown, Terapagos ex SIR
        //   (substituted for Lance's Charizard ex SAR — newer card not yet indexed)
        ("SC", 170, "SIR") => "Pokemon Terapagos ex Stellar Crown 170 Special Illustration Rare PSA 10",

        // slots 43-44 — Pokemon GO
        ("PGO", 11, "RR")  => "Pokemon Radiant Charizard Pokemon GO 11 Radiant Rare PSA 10",
        ("PGO", 86, "AA")  => "Pokemon Mewtwo VSTAR Pokemon GO 86 Alt Art PSA 10",

        // slot 45 — Paldean Fates, Penny SAR (sv4pt5-239, NOT 91)
        ("PaF", 239, "SAR") => "Pokemon Penny Paldean Fates 239 Special Art Rare PSA 10",

        // slot 46 — Hydreigon ex SIR is actually in Surging Sparks (sv8-240), NOT Twilight Masquerade
        ("SS", 240, "SIR") => "Pokemon Hydreigon ex Surging Sparks 240 Special Illustration Rare PSA 10",

        // slot 47 — Paradox Rift, Mela SAR (sv4-254, NOT 191)
        ("PR", 254, "SAR") => "Pokemon Mela Paradox Rift 254 Special Art Rare PSA 10",

        // slot 48 — Paldea Evolved, Boss's Orders (Ghetsis) SIR (sv2-265, NOT 270)
        //   Note: card is officially "Boss's Orders (Ghetsis)" — sellers list it
        //   under both spellings; the query matches either via "Boss's Orders".
        ("PaE", 265, "SAR") => "Pokemon Boss's Orders Ghetsis Paldea Evolved 265 Special Illustration Rare PSA 10",

        // slot 49 — Obsidian Flames, Tyranitar ex Alt Art (no SIR variant exists; sv3-211 Ultra Rare = the AA)
        //   Note: variant moved from "SIR" to "AA" on-chain.
        ("OF", 211, "AA")  => "Pokemon Tyranitar ex Obsidian Flames 211 Alt Art PSA 10",

        _ => return None,
    };
    Some(s.to_string())
}

/// v0.2 fallback: deterministically drift on-chain base prices by ±2%, day-keyed.
fn compute_drift(
    day: u32,
    constituents: &[ConstituentInfo],
) -> (
    [u64; CONSTITUENT_COUNT],
    [u16; CONSTITUENT_COUNT],
    [u8; 32],
) {
    let mut prices = [0u64; CONSTITUENT_COUNT];
    let sale_counts = [50u16; CONSTITUENT_COUNT];
    for (i, c) in constituents.iter().enumerate() {
        prices[i] = drift_price(c.base_price, day, i);
        if prices[i] == 0 {
            prices[i] = 100_000_000;
        }
    }
    let root = placeholder_root(day, &prices);
    (prices, sale_counts, root)
}

/// Real source path: fetch eBay listings per constituent, run the methodology
/// pipeline, accumulate merkle leaves over actually-used sales. If a constituent
/// can't be priced (insufficient samples in any fallback window), fall back to
/// decayed base_price + sale_count=1.
async fn compute_from_ebay(
    cfg: &config::Config,
    day: u32,
    constituents: &[ConstituentInfo],
    state: &mut PublisherState,
) -> Result<(
    [u64; CONSTITUENT_COUNT],
    [u16; CONSTITUENT_COUNT],
    [u8; 32],
)> {
    let source: Box<dyn PriceSource> = Box::new(build_ebay_source(cfg)?);
    compute_from_source(source, cfg, day, constituents, state).await
}

/// v0.9: scrape-based price source. Calls our standalone services/scraper
/// Node service (Oxylabs-backed eBay search), feeds the resulting listings
/// into the same methodology pipeline as ebay_browse.  Used when the official
/// Marketplace Insights tier isn't available.  Config: `[sources.scraper].url`
/// or `SCRAPER_URL` env var.
async fn compute_from_scraper(
    cfg: &config::Config,
    day: u32,
    constituents: &[ConstituentInfo],
    state: &mut PublisherState,
) -> Result<(
    [u64; CONSTITUENT_COUNT],
    [u16; CONSTITUENT_COUNT],
    [u8; 32],
)> {
    let url = std::env::var("SCRAPER_URL").ok().or_else(|| {
        cfg.sources
            .per_source
            .get("scraper")
            .and_then(|v| v.get("url"))
            .and_then(|v| v.as_str().map(String::from))
    });
    let url = url.ok_or_else(|| {
        anyhow!(
            "scraper source requires SCRAPER_URL env var or [sources.scraper].url in config"
        )
    })?;
    info!(scraper_url = %url, "using scraper source");
    let source: Box<dyn PriceSource> = Box::new(sources::scraper::ScraperSource::new(url));
    compute_from_source(source, cfg, day, constituents, state).await
}

/// Shared listing-source pipeline: iterate constituents, call the source for
/// each, apply the methodology, fall back to Card-Codex aggregate, then to
/// stale-decay.  Source-agnostic — works for ebay_browse, scraper, or any
/// future `PriceSource` impl.
async fn compute_from_source(
    source: Box<dyn PriceSource>,
    cfg: &config::Config,
    day: u32,
    constituents: &[ConstituentInfo],
    state: &mut PublisherState,
) -> Result<(
    [u64; CONSTITUENT_COUNT],
    [u16; CONSTITUENT_COUNT],
    [u8; 32],
)> {
    // Aggregate fallback (Card-Codex) is queried when the listing-based source
    // returns insufficient samples. Always-on for now — no config gate needed
    // because the per-card URL mapping returns None for cards Card-Codex
    // doesn't cover, naturally falling through to apply_decay.
    let aggregate: Box<dyn AggregatePriceSource> =
        Box::new(sources::card_codex::CardCodexSource::new());
    let methodology_cfg = MethodologyConfig {
        trim_top_pct: cfg.methodology.trim_top_pct,
        trim_bottom_pct: cfg.methodology.trim_bottom_pct,
        min_sample_size: cfg.methodology.min_sample_size,
        window_days_primary: cfg.methodology.window_days_primary,
        window_days_fallback: cfg.methodology.window_days_fallback.clone(),
    };
    let decay = cfg.methodology.stale_decay_pct_per_day;

    let now = chrono::Utc::now().timestamp();
    let widest_window_days = *cfg
        .methodology
        .window_days_fallback
        .iter()
        .chain(std::iter::once(&cfg.methodology.window_days_primary))
        .max()
        .unwrap_or(&cfg.methodology.window_days_primary);
    let window = TimeWindow {
        start_unix: now - (widest_window_days as i64) * 86_400,
        end_unix: now,
    };

    let mut prices = [0u64; CONSTITUENT_COUNT];
    let mut sale_counts = [0u16; CONSTITUENT_COUNT];
    let mut all_leaves: Vec<[u8; 32]> = Vec::new();

    for (i, c) in constituents.iter().enumerate() {
        let query = ConstituentQuery {
            set_code: c.set_code.clone(),
            collector_number: c.collector_number,
            set_total: c.set_total,
            variant_code: c.variant_code.clone(),
            canonical_search_string: c.search_string(),
        };
        let listings = match source.fetch_listings(&query, window.clone()).await {
            Ok(l) => l,
            Err(e) => {
                warn!(constituent = i, error = ?e, "fetch failed; falling back to stale");
                vec![]
            }
        };
        let computed =
            methodology::compute_constituent(listings, &c.variant_code, now, &methodology_cfg);
        match computed {
            Some(result) => {
                prices[i] = result.price_microusdc;
                sale_counts[i] = result.sample_count;
                accumulate_leaves(&mut all_leaves, i as u8, &result.leaves);
                // Record the fresh day for this slot so future stale fallbacks
                // can compute days_since_fresh accurately.
                state.record_fresh(i as u8, day);
                info!(
                    constituent = i,
                    price = result.price_microusdc,
                    sample_count = result.sample_count,
                    window_days = result.window_days_used,
                    "constituent priced"
                );
            }
            None => {
                // Try the aggregate source (Card-Codex) before falling to decay.
                // The aggregate is a single pre-trimmed PSA 10 number — we
                // treat it as authoritative when present (no extra trim) but
                // record sample_count = 1 to signal "single point" provenance.
                let aggregate_price = aggregate.fetch_price(&query).await.ok().flatten();
                if let Some(p) = aggregate_price {
                    prices[i] = p;
                    sale_counts[i] = 1;
                    // Aggregate counts as a fresh observation — the source is
                    // current. Record so decay doesn't fire on next miss.
                    state.record_fresh(i as u8, day);
                    info!(
                        constituent = i,
                        price = p,
                        source = aggregate.name(),
                        "constituent priced via aggregate fallback"
                    );
                } else {
                    // Real days_since_fresh from PublisherState (v0.3.1).
                    // Defaults to 1 when no prior fresh record exists, matching
                    // the v0.2 hardcoded fallback.
                    let days_since_fresh = state.days_since_fresh(i as u8, day);
                    let decayed =
                        methodology::apply_decay(c.base_price, days_since_fresh, decay);
                    prices[i] = decayed.max(1);
                    sale_counts[i] = 1;
                    warn!(
                        constituent = i,
                        decayed_price = prices[i],
                        days_since_fresh,
                        "stale fallback (no listings + no aggregate)"
                    );
                }
            }
        }
    }

    let source_root = merkle::root(all_leaves);
    let _ = day; // day is encoded in PriceUpdate args, not the root (leaves identify themselves)
    Ok((prices, sale_counts, source_root))
}

fn accumulate_leaves(
    out: &mut Vec<[u8; 32]>,
    constituent_index: u8,
    listings: &[SoldListing],
) {
    let mut sorted = listings.to_vec();
    sorted.sort_by(|a, b| a.listing_id.cmp(&b.listing_id));
    for l in &sorted {
        out.push(merkle::leaf(constituent_index, l));
    }
}

fn build_ebay_source(cfg: &config::Config) -> Result<sources::ebay_browse::EbayBrowseSource> {
    let raw = cfg
        .sources
        .per_source
        .get("ebay_browse")
        .ok_or_else(|| anyhow!("[sources.ebay_browse] section missing"))?;
    let app_id = raw
        .get("app_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("[sources.ebay_browse].app_id missing"))?;
    let cert_id = raw
        .get("cert_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("[sources.ebay_browse].cert_id missing"))?;
    let rate_limit_rpm = raw
        .get("rate_limit_rpm")
        .and_then(|v| v.as_integer())
        .unwrap_or(100) as u32;
    if app_id.starts_with("${") || cert_id.starts_with("${") {
        return Err(anyhow!(
            "ebay credentials still contain ${{...}} placeholder — set EBAY_APP_ID / EBAY_CERT_ID in env"
        ));
    }
    Ok(sources::ebay_browse::EbayBrowseSource::new(
        app_id.into(),
        cert_id.into(),
        rate_limit_rpm,
    ))
}

fn drift_price(base_microusdc: u64, day: u32, slot: usize) -> u64 {
    if base_microusdc == 0 {
        return 0;
    }
    let signed = ((day as i64 * 13 + slot as i64 * 7) % 401) - 200;
    let scaled = (base_microusdc as i128) * (10_000 + signed as i128) / 10_000;
    scaled.max(1) as u64
}

fn placeholder_root(day: u32, prices: &[u64; CONSTITUENT_COUNT]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(b"placeholder:");
    h.update(day.to_le_bytes());
    for p in prices {
        h.update(p.to_le_bytes());
    }
    h.finalize().into()
}

/// Parse all `CONSTITUENT_COUNT` constituents from the raw account bytes.
/// Layout (see programs/oracle/src/state.rs ConstituentRegistry, repr(C) zero_copy):
///   offset 0..8:                       Anchor discriminator
///   offset 8 .. 8+64×N:                constituents [Constituent; N]   (64 bytes each)
///
/// Each Constituent (offsets relative to its own start):
///   0..8:    base_price (u64)
///   8..40:   canonical_search_hash ([u8; 32])
///   40..48:  set_code ([u8; 8])
///   48..56:  variant_code ([u8; 8])
///   56..58:  collector_number (u16)
///   58..60:  set_total (u16)
///   60..64:  _pad
fn parse_registry(data: &[u8]) -> Result<Vec<ConstituentInfo>> {
    const DISCRIMINATOR_BYTES: usize = 8;
    const STRIDE: usize = 64;
    const MIN_LEN: usize = DISCRIMINATOR_BYTES + CONSTITUENT_COUNT * STRIDE;
    if data.len() < MIN_LEN {
        return Err(anyhow!(
            "registry account too short: {} bytes (need >= {})",
            data.len(),
            MIN_LEN
        ));
    }

    let mut out = Vec::with_capacity(CONSTITUENT_COUNT);
    for i in 0..CONSTITUENT_COUNT {
        let off = DISCRIMINATOR_BYTES + i * STRIDE;
        let base_price = u64::from_le_bytes(data[off..off + 8].try_into().unwrap());
        let set_code = bytes_to_ascii_string(&data[off + 40..off + 48]);
        let variant_code = bytes_to_ascii_string(&data[off + 48..off + 56]);
        let collector_number = u16::from_le_bytes(data[off + 56..off + 58].try_into().unwrap());
        let set_total = u16::from_le_bytes(data[off + 58..off + 60].try_into().unwrap());
        out.push(ConstituentInfo {
            base_price,
            set_code,
            variant_code,
            collector_number,
            set_total,
        });
    }
    Ok(out)
}

/// Trim a fixed-length ASCII field (null-padded) into a String.
fn bytes_to_ascii_string(b: &[u8]) -> String {
    let end = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    String::from_utf8_lossy(&b[..end]).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drift_is_within_2pct() {
        let base = 1_000_000_000u64;
        for day in 0..30u32 {
            for slot in 0..CONSTITUENT_COUNT {
                let p = drift_price(base, day, slot);
                let pct = ((p as i128 - base as i128) * 10_000) / (base as i128);
                assert!(pct.abs() <= 200, "day={} slot={} pct_bps={}", day, slot, pct);
            }
        }
    }

    #[test]
    fn drift_zero_stays_zero() {
        assert_eq!(drift_price(0, 1, 0), 0);
    }

    #[test]
    fn bytes_to_ascii_handles_padding() {
        assert_eq!(bytes_to_ascii_string(b"SV01\0\0\0\0"), "SV01");
        assert_eq!(bytes_to_ascii_string(b"EVS\0\0\0\0\0"), "EVS");
        assert_eq!(bytes_to_ascii_string(b"FULL8BYTE"), "FULL8BYTE");
    }

    #[test]
    fn search_string_renders_with_variant() {
        let c = ConstituentInfo {
            base_price: 1_000_000_000,
            set_code: "EVS".into(),
            variant_code: "AA".into(),
            collector_number: 186,
            set_total: 195,
        };
        assert_eq!(c.search_string(), "Pokemon EVS 186/195 Alt Art PSA 10");
    }

    #[test]
    fn search_string_handles_empty_set_code() {
        let c = ConstituentInfo {
            base_price: 0,
            set_code: "".into(),
            variant_code: "SIR".into(),
            collector_number: 199,
            set_total: 165,
        };
        assert_eq!(c.search_string(), "Pokemon 199/165 SIR PSA 10");
    }
}
