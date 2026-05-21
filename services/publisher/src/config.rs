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

/// Substitute `${VAR}` (or `${VAR:-default}`) from the environment.
/// Unknown variables without defaults are left as-is so downstream parsing fails
/// loudly rather than silently substituting empty string.
/// Spec: docs/publisher.md §4.
fn expand_env_vars(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if c == '$' && input[i..].starts_with("${") {
            if let Some(end_rel) = input[i + 2..].find('}') {
                let end = i + 2 + end_rel;
                let expr = &input[i + 2..end];
                let (name, default) = match expr.split_once(":-") {
                    Some((n, d)) => (n, Some(d)),
                    None => (expr, None),
                };
                let value = std::env::var(name).ok().or_else(|| default.map(String::from));
                match value {
                    Some(v) => out.push_str(&v),
                    None => out.push_str(&input[i..=end]),
                }
                // Advance past the closing `}`.
                while let Some(&(j, _)) = chars.peek() {
                    if j <= end {
                        chars.next();
                    } else {
                        break;
                    }
                }
                continue;
            }
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_existing_var() {
        std::env::set_var("POKEPERP_TEST_X", "hello");
        assert_eq!(expand_env_vars("a${POKEPERP_TEST_X}b"), "ahellob");
    }

    #[test]
    fn leaves_unknown_var_as_is() {
        std::env::remove_var("POKEPERP_TEST_DOES_NOT_EXIST");
        assert_eq!(
            expand_env_vars("a${POKEPERP_TEST_DOES_NOT_EXIST}b"),
            "a${POKEPERP_TEST_DOES_NOT_EXIST}b"
        );
    }

    #[test]
    fn uses_default_when_unset() {
        std::env::remove_var("POKEPERP_TEST_UNSET_DEFAULT");
        assert_eq!(
            expand_env_vars("a${POKEPERP_TEST_UNSET_DEFAULT:-fallback}b"),
            "afallbackb"
        );
    }
}
