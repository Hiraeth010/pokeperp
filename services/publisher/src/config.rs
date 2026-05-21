//! Configuration loader for publisher.toml.
//! Spec: docs/publisher.md §4.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Deserialize, Debug)]
pub struct Config {
    pub identity: Identity,
    pub oracle: Oracle,
    pub methodology: Methodology,
    pub sources: Sources,
    pub schedule: Schedule,
    pub observability: Observability,
    pub security: Security,
}

#[derive(Deserialize, Debug)]
pub struct Identity {
    pub publisher_keypair_path: String,
    pub publisher_pubkey: String,
}

#[derive(Deserialize, Debug)]
pub struct Oracle {
    pub rpc_url: String,
    pub oracle_program_id: String,
    #[serde(default = "default_commitment")]
    pub commitment: String,
}

fn default_commitment() -> String {
    "confirmed".into()
}

#[derive(Deserialize, Debug)]
pub struct Methodology {
    pub trim_top_pct: u8,
    pub trim_bottom_pct: u8,
    pub min_sample_size: usize,
    pub window_days_primary: u32,
    pub window_days_fallback: Vec<u32>,
    pub stale_decay_pct_per_day: f64,
}

#[derive(Deserialize, Debug)]
pub struct Sources {
    pub primary: String,
    pub secondary: Vec<String>,
    /// Per-source `[sources.<name>]` tables are passed through as raw TOML values.
    /// Each source module parses its own subset.
    #[serde(flatten)]
    pub per_source: HashMap<String, toml::Value>,
}

#[derive(Deserialize, Debug)]
pub struct Schedule {
    pub submit_at_utc_hour: u32,
    pub submit_at_utc_minute: u32,
    pub retry_max_attempts: u32,
    pub retry_backoff_seconds: u64,
}

#[derive(Deserialize, Debug)]
pub struct Observability {
    pub metrics_port: u16,
    pub log_level: String,
    pub log_format: String,
}

#[derive(Deserialize, Debug)]
pub struct Security {
    pub allow_dry_run_only: bool,
    pub require_sample_count_consistency: bool,
}

pub fn load(path: impl AsRef<Path>) -> Result<Config> {
    let text = std::fs::read_to_string(path.as_ref())
        .with_context(|| format!("reading {}", path.as_ref().display()))?;
    let expanded = expand_env_vars(&text);
    let cfg: Config = toml::from_str(&expanded).context("parsing publisher.toml")?;
    Ok(cfg)
}

/// Substitute `${VAR}` from the environment.
/// Spec: docs/publisher.md §4.
fn expand_env_vars(_input: &str) -> String {
    // TODO: scan for ${NAME} patterns, look up std::env::var, substitute
    _input.to_string()
}
