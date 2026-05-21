//! Pokeperp publisher service.
//!
//! Fetches PSA 10 prices for the 25 PMT25 constituents, applies the methodology,
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
mod submit;

use anyhow::{anyhow, Context, Result};
use clap::{Parser, Subcommand};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    pubkey::Pubkey,
    signature::{read_keypair_file, Signer},
};
use std::str::FromStr;
use tracing::{info, warn};

use crate::methodology::MethodologyConfig;
use crate::sources::{ConstituentQuery, PriceSource, SoldListing, TimeWindow};
use crate::submit::SubmitParams;

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

    match cli.command {
        Command::Run { dry_run, day } => run_daily(&cfg, dry_run, day).await,
        Command::Daemon => daemon_loop(&cfg).await,
    }
}

/// One submission cycle: read on-chain state, compute prices, submit.
async fn run_daily(cfg: &config::Config, dry_run: bool, day_override: Option<u32>) -> Result<()> {
    let oracle_program_id = Pubkey::from_str(&cfg.oracle.oracle_program_id)
        .context("parsing oracle.oracle_program_id")?;
    let client = RpcClient::new_with_commitment(
        cfg.oracle.rpc_url.clone(),
        CommitmentConfig::confirmed(),
    );

    let keypair = read_keypair_file(&cfg.identity.publisher_keypair_path)
        .map_err(|e| anyhow!("read keypair {}: {}", cfg.identity.publisher_keypair_path, e))?;
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
            compute_from_ebay(cfg, day, &constituents)
                .await
                .context("compute_from_ebay")?
        }
        other => {
            return Err(anyhow!(
                "unknown [sources] primary: {:?} (expected 'drift' or 'ebay_browse')",
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
async fn daemon_loop(cfg: &config::Config) -> Result<()> {
    info!(
        hour = cfg.schedule.submit_at_utc_hour,
        minute = cfg.schedule.submit_at_utc_minute,
        "starting publisher daemon"
    );
    loop {
        let sleep_secs = seconds_until_next(
            cfg.schedule.submit_at_utc_hour,
            cfg.schedule.submit_at_utc_minute,
        );
        info!(sleep_secs, "next submission in");
        tokio::time::sleep(std::time::Duration::from_secs(sleep_secs)).await;
        match run_daily(cfg, false, None).await {
            Ok(()) => info!("submission ok"),
            Err(e) => warn!(error = ?e, "submission failed; will retry next cycle"),
        }
    }
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
    /// Construct a default eBay query from registry fields. Publishers can override
    /// this later via an explicit per-slot config table — but as long as the registry
    /// `canonical_search_hash` is the SHA-256 of this same string, the on-chain hash
    /// match works.
    fn search_string(&self) -> String {
        // "Pokemon {set_code} {n}/{set_total} {variant} PSA 10"
        // Empty set_code or variant_code is OK; we still include the rest.
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

/// v0.2 fallback: deterministically drift on-chain base prices by ±2%, day-keyed.
fn compute_drift(day: u32, constituents: &[ConstituentInfo]) -> ([u64; 25], [u16; 25], [u8; 32]) {
    let mut prices = [0u64; 25];
    let sale_counts = [50u16; 25];
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
) -> Result<([u64; 25], [u16; 25], [u8; 32])> {
    let source = build_ebay_source(cfg)?;
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

    let mut prices = [0u64; 25];
    let mut sale_counts = [0u16; 25];
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
                info!(
                    constituent = i,
                    price = result.price_microusdc,
                    sample_count = result.sample_count,
                    window_days = result.window_days_used,
                    "constituent priced"
                );
            }
            None => {
                let days_since_fresh = 1; // v0.2: we don't yet track last-fresh-day per constituent
                let decayed = methodology::apply_decay(c.base_price, days_since_fresh, decay);
                prices[i] = decayed.max(1);
                sale_counts[i] = 1; // on-chain handler rejects zero
                warn!(
                    constituent = i,
                    decayed_price = prices[i],
                    "stale fallback (insufficient samples)"
                );
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

fn placeholder_root(day: u32, prices: &[u64; 25]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(b"placeholder:");
    h.update(day.to_le_bytes());
    for p in prices {
        h.update(p.to_le_bytes());
    }
    h.finalize().into()
}

/// Parse all 25 constituents from the raw account bytes.
/// Layout (see programs/oracle/src/state.rs ConstituentRegistry, repr(C) zero_copy):
///   offset 0..8:     Anchor discriminator
///   offset 8..1608:  constituents [Constituent; 25]   (64 bytes each)
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
    const MIN_LEN: usize = DISCRIMINATOR_BYTES + 25 * STRIDE;
    if data.len() < MIN_LEN {
        return Err(anyhow!(
            "registry account too short: {} bytes (need >= {})",
            data.len(),
            MIN_LEN
        ));
    }

    let mut out = Vec::with_capacity(25);
    for i in 0..25 {
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
            for slot in 0..25usize {
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
