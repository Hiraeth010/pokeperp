//! Pokeperp publisher service.
//!
//! Fetches PSA 10 prices for the 25 PMT25 constituents, applies the methodology,
//! and submits a signed PriceUpdate to the on-chain oracle. v0.2 simplification:
//! prices are derived deterministically from on-chain base prices with small
//! day-keyed noise (no external HTTP source yet). Real eBay/Card-Codex fetching
//! is layered in via the `sources` module — currently all stubs.
//!
//! Spec: docs/publisher.md (architecture), docs/methodology.md §6 (trimming rules),
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

/// One submission cycle: read on-chain state, build prices, submit.
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

    // Read the on-chain ConstituentRegistry to know each slot's base_price.
    let (registry_pda, _) =
        Pubkey::find_program_address(&[b"registry"], &oracle_program_id);
    let registry_data = client
        .get_account_data(&registry_pda)
        .context("fetch ConstituentRegistry account")?;
    let base_prices = parse_registry_base_prices(&registry_data)
        .context("parse ConstituentRegistry")?;

    // Day-keyed deterministic drift so prices change daily but reproducibly.
    let current_day = (chrono::Utc::now().timestamp() / 86_400) as u32;
    let day = day_override.unwrap_or(current_day - 1);
    info!(day, current_day, "computing prices");

    let mut prices = [0u64; 25];
    let mut sale_counts = [50u16; 25];
    for (i, base) in base_prices.iter().enumerate() {
        prices[i] = drift_price(*base, day, i);
        if prices[i] == 0 {
            prices[i] = 100_000_000; // $100 placeholder; handler rejects zero
        }
    }

    info!(
        slot0 = prices[0],
        slot1 = prices[1],
        slot2 = prices[2],
        "drifted prices (first 3)"
    );

    // v0.2: source_root is a placeholder. v0.3 will hash real listing leaves.
    let source_root = compute_placeholder_root(day, &prices);

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

/// Compute seconds from now until the next occurrence of (hour, minute) UTC.
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

/// Apply small deterministic drift to a base price: ±2% keyed on (day, slot).
/// Replace with real source-driven prices when sources/* implementations land.
fn drift_price(base_microusdc: u64, day: u32, slot: usize) -> u64 {
    if base_microusdc == 0 {
        return 0;
    }
    // Deterministic noise in basis points: range [-200, +200] = ±2%.
    let signed = ((day as i64 * 13 + slot as i64 * 7) % 401) - 200;
    let scaled = (base_microusdc as i128) * (10_000 + signed as i128) / 10_000;
    scaled.max(1) as u64
}

/// Placeholder source_root: SHA-256(day || prices[..]). Not a real merkle yet.
fn compute_placeholder_root(day: u32, prices: &[u64; 25]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(b"placeholder:");
    h.update(day.to_le_bytes());
    for p in prices {
        h.update(p.to_le_bytes());
    }
    h.finalize().into()
}

/// Read base_price for each of the 25 constituents from the raw account bytes.
/// Layout (see programs/oracle/src/state.rs ConstituentRegistry, repr(C) zero_copy):
///   offset 0..8:        Anchor discriminator
///   offset 8..1608:     constituents [Constituent; 25] (64 bytes each)
///   offset 1608..1612:  version (u32)
///   offset 1612..1616:  effective_day (u32)
///   offset 1616..1617:  bump (u8)
///   offset 1617..1624:  _pad (7 bytes)
///
/// Each Constituent has base_price (u64) at its local offset 0.
fn parse_registry_base_prices(data: &[u8]) -> Result<[u64; 25]> {
    const DISCRIMINATOR_BYTES: usize = 8;
    const CONSTITUENT_STRIDE: usize = 64;
    const MIN_LEN: usize = DISCRIMINATOR_BYTES + 25 * CONSTITUENT_STRIDE;
    if data.len() < MIN_LEN {
        return Err(anyhow!(
            "registry account too short: {} bytes (need >= {})",
            data.len(),
            MIN_LEN
        ));
    }
    let mut out = [0u64; 25];
    for i in 0..25 {
        let off = DISCRIMINATOR_BYTES + i * CONSTITUENT_STRIDE;
        let bytes: [u8; 8] = data[off..off + 8]
            .try_into()
            .map_err(|_| anyhow!("slice into [u8; 8]"))?;
        out[i] = u64::from_le_bytes(bytes);
    }
    Ok(out)
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
}
