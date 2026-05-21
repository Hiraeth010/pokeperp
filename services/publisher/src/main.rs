//! Pokeperp publisher service.
//!
//! Fetches eBay PSA 10 sold listings for the 25 PMT25 constituents, applies the
//! methodology rules, and submits a signed PriceUpdate to the on-chain oracle.
//!
//! Spec: docs/publisher.md (architecture), docs/methodology.md §6 (trimming rules),
//! docs/oracle.md §4 (submission format).

mod config;
mod merkle;
mod methodology;
mod sources;
mod submit;

use anyhow::Result;
use clap::{Parser, Subcommand};
use tracing::info;

#[derive(Parser)]
#[command(name = "pokeperp-publisher", version)]
struct Cli {
    /// Path to publisher.toml.
    #[arg(long, default_value = "/etc/pokeperp/publisher.toml")]
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
    },
    /// Backfill historical days for verification (does not submit).
    Backfill {
        #[arg(long)]
        from: String,
        #[arg(long)]
        to: String,
    },
    /// Re-run a day's computation and compare to the on-chain submission.
    Verify {
        #[arg(long)]
        day: u32,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();
    let cfg = config::load(&cli.config)?;

    match cli.command {
        Command::Run { dry_run } => run_daily(&cfg, dry_run).await,
        Command::Backfill { from, to } => backfill(&cfg, &from, &to).await,
        Command::Verify { day } => verify(&cfg, day).await,
    }
}

/// Daily routine.
/// Spec: docs/publisher.md §3 (workflow).
async fn run_daily(_cfg: &config::Config, _dry_run: bool) -> Result<()> {
    // TODO:
    //   1. Load ConstituentRegistry from oracle program
    //   2. For each constituent: fetch listings from configured sources, methodology::compute_constituent
    //   3. Build merkle root over all leaves
    //   4. submit::submit (skip if dry_run)
    //   5. Emit metrics + structured logs
    info!("daily routine: not yet implemented");
    Ok(())
}

/// Historical backfill — no on-chain submission.
/// Spec: docs/publisher.md §10 backfill mode.
async fn backfill(_cfg: &config::Config, _from: &str, _to: &str) -> Result<()> {
    info!("backfill: not yet implemented");
    Ok(())
}

/// Local re-run for audit / dispute purposes.
/// Spec: docs/publisher.md §10 verify mode.
async fn verify(_cfg: &config::Config, _day: u32) -> Result<()> {
    info!("verify: not yet implemented");
    Ok(())
}
