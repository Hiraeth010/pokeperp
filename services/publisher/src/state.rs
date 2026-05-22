//! Persistent publisher operational state.
//!
//! Tracks the most recent day each constituent had a "fresh" aggregate (i.e.
//! the methodology pipeline produced a `Computed` result rather than falling
//! through to stale-decay). On the next run, slots that DON'T have fresh
//! samples available read their `last_fresh_day` from this file to compute
//! `days_since_fresh` for `apply_decay` — replacing the v0.2 hardcoded `1`.
//!
//! Serialized as JSON (one tiny file, append-mostly, human-readable for
//! debugging). Path is derived from the publisher.toml location:
//! `<config_dir>/<config_stem>.state.json`.
//!
//! Schema:
//! ```json
//! {
//!   "last_fresh_day": { "0": 20594, "1": 20593, ... }
//! }
//! ```
//! JSON object keys are strings even for numeric data, so the inner map keys
//! parse as u8 via serde_json's `with` attribute.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Per-constituent operational state persisted across runs.
#[derive(Default, Serialize, Deserialize, Debug, Clone)]
pub struct PublisherState {
    /// Constituent index (0..25) → last day a fresh aggregate was computed.
    /// Days are Unix days since epoch (i.e. `timestamp / 86_400`).
    #[serde(with = "u8_keyed_map")]
    pub last_fresh_day: HashMap<u8, u32>,
}

impl PublisherState {
    /// Read state from disk. Returns a default (empty) state if the file
    /// doesn't exist — the very first publisher run has no history.
    pub fn load(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let text = std::fs::read_to_string(path)
            .with_context(|| format!("reading {}", path.display()))?;
        let state: PublisherState = serde_json::from_str(&text)
            .with_context(|| format!("parsing {}", path.display()))?;
        Ok(state)
    }

    /// Write state to disk. Creates parent dirs if missing.
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .with_context(|| format!("mkdir {}", parent.display()))?;
            }
        }
        let text = serde_json::to_string_pretty(self)
            .context("serializing PublisherState")?;
        std::fs::write(path, text)
            .with_context(|| format!("writing {}", path.display()))?;
        Ok(())
    }

    /// Record that constituent `idx` got a fresh aggregate on day `day`.
    /// Always overwrites — most recent fresh day wins.
    pub fn record_fresh(&mut self, idx: u8, day: u32) {
        self.last_fresh_day.insert(idx, day);
    }

    /// Compute `days_since_fresh` for a constituent given the current day.
    /// Returns the same `1` v0.2 fallback when there's no record yet (first
    /// run, constituent never had a fresh aggregate). Returns 0 if `current_day`
    /// is at or before the last fresh day (no decay applies).
    pub fn days_since_fresh(&self, idx: u8, current_day: u32) -> u32 {
        match self.last_fresh_day.get(&idx) {
            Some(&last) if current_day > last => current_day - last,
            Some(_) => 0,
            None => 1,
        }
    }
}

/// Derive the state file path from the publisher.toml path. E.g.
/// `examples/publisher.localnet.toml` → `examples/publisher.localnet.state.json`.
pub fn state_path_for_config(config_path: &Path) -> PathBuf {
    let parent = config_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = config_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "publisher".to_string());
    parent.join(format!("{}.state.json", stem))
}

/// Custom serde for `HashMap<u8, u32>` — JSON object keys are always strings,
/// so we serialize as `{"0": 20594, ...}` and parse them back to u8.
mod u8_keyed_map {
    use serde::de::Error as _;
    use serde::ser::SerializeMap as _;
    use serde::{Deserialize, Deserializer, Serializer};
    use std::collections::HashMap;

    pub fn serialize<S>(map: &HashMap<u8, u32>, ser: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = ser.serialize_map(Some(map.len()))?;
        for (k, v) in map {
            s.serialize_entry(&k.to_string(), v)?;
        }
        s.end()
    }

    pub fn deserialize<'de, D>(de: D) -> Result<HashMap<u8, u32>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let string_map = HashMap::<String, u32>::deserialize(de)?;
        let mut out = HashMap::with_capacity(string_map.len());
        for (k, v) in string_map {
            let idx: u8 = k.parse().map_err(D::Error::custom)?;
            out.insert(idx, v);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn tmp_path(name: &str) -> PathBuf {
        env::temp_dir().join(format!("pokeperp_state_test_{}.json", name))
    }

    #[test]
    fn roundtrip_load_save() {
        let mut s = PublisherState::default();
        s.record_fresh(0, 20594);
        s.record_fresh(5, 20593);
        s.record_fresh(24, 20500);
        let path = tmp_path("roundtrip");
        s.save(&path).unwrap();
        let s2 = PublisherState::load(&path).unwrap();
        assert_eq!(s2.last_fresh_day.get(&0), Some(&20594));
        assert_eq!(s2.last_fresh_day.get(&5), Some(&20593));
        assert_eq!(s2.last_fresh_day.get(&24), Some(&20500));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_file_returns_default() {
        let path = tmp_path("missing");
        let _ = std::fs::remove_file(&path);
        let s = PublisherState::load(&path).unwrap();
        assert!(s.last_fresh_day.is_empty());
    }

    #[test]
    fn days_since_fresh_default_when_no_record() {
        let s = PublisherState::default();
        assert_eq!(s.days_since_fresh(0, 20594), 1);
    }

    #[test]
    fn days_since_fresh_computes_delta() {
        let mut s = PublisherState::default();
        s.record_fresh(0, 20590);
        assert_eq!(s.days_since_fresh(0, 20594), 4);
        // Same day or future-day-on-chain → no decay
        assert_eq!(s.days_since_fresh(0, 20590), 0);
        assert_eq!(s.days_since_fresh(0, 20580), 0);
    }

    #[test]
    fn state_path_default_layout() {
        let cfg = Path::new("examples/publisher.localnet.toml");
        let state = state_path_for_config(cfg);
        assert_eq!(
            state,
            Path::new("examples/publisher.localnet.state.json")
        );
    }

    #[test]
    fn state_path_bare_filename() {
        let cfg = Path::new("publisher.toml");
        let state = state_path_for_config(cfg);
        assert_eq!(state, Path::new("publisher.state.json"));
    }

    #[test]
    fn record_fresh_overwrites() {
        let mut s = PublisherState::default();
        s.record_fresh(0, 20590);
        s.record_fresh(0, 20594);
        assert_eq!(s.last_fresh_day.get(&0), Some(&20594));
    }
}
