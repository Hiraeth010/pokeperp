//! Methodology application (publisher-side).
//! Spec: docs/methodology.md §6, docs/oracle.md §3, docs/publisher.md §6.

use crate::sources::SoldListing;
use anyhow::Result;

pub struct MethodologyConfig {
    pub trim_top_pct: u8,
    pub trim_bottom_pct: u8,
    pub min_sample_size: usize,
    pub window_days_primary: u32,
    pub window_days_fallback: Vec<u32>,
}

pub enum ConstituentResult {
    Computed {
        price_microusdc: u64,
        sample_count: u16,
        window_days_used: u32,
        leaves: Vec<SoldListing>,
    },
    Stale {
        decayed_price: u64,
    },
}

/// Apply the mandatory publisher-side listing filters.
/// Spec: docs/methodology.md §6, docs/oracle.md §3.
pub fn apply_filters(listings: Vec<SoldListing>) -> Vec<SoldListing> {
    listings
        .into_iter()
        .filter(title_contains_psa_10_clean)
        .filter(title_is_english)
        .filter(shipping_ratio_ok)
        // TODO: variant keyword match, buyer/seller blacklist match (oracle.md §3)
        .collect()
}

/// Listing title contains "PSA 10" but no qualifier code (OC, ST, MK, PD, MC).
/// Spec: docs/methodology.md §1 (qualifier excluded), §9 edge cases.
fn title_contains_psa_10_clean(_l: &SoldListing) -> bool {
    // TODO: case-insensitive regex `\bPSA[ -]?10\b` AND no qualifier suffix
    true
}

/// Heuristic: listing is in English.
/// Spec: docs/methodology.md §1 (English only).
fn title_is_english(_l: &SoldListing) -> bool {
    // TODO: detect Japanese / CJK characters and reject; also detect known non-EN listings
    true
}

/// Drop listings where shipping > 0.5 × item price.
/// Spec: docs/oracle.md §3 mandatory filters.
fn shipping_ratio_ok(l: &SoldListing) -> bool {
    if l.price_microusdc == 0 {
        return false;
    }
    l.shipping_microusdc * 2 <= l.price_microusdc
}

/// Trimmed mean: drop top/bottom N% by price, arithmetic mean of remainder.
/// Spec: docs/methodology.md §6.
pub fn trimmed_mean(prices: &[u64], trim_top_pct: u8, trim_bottom_pct: u8) -> Option<u64> {
    if prices.is_empty() {
        return None;
    }
    let mut sorted = prices.to_vec();
    sorted.sort_unstable();
    let n = sorted.len();
    let top_trim = (n * trim_top_pct as usize) / 100;
    let bottom_trim = (n * trim_bottom_pct as usize) / 100;
    if top_trim + bottom_trim >= n {
        return None;
    }
    let trimmed = &sorted[bottom_trim..n - top_trim];
    Some(trimmed.iter().sum::<u64>() / trimmed.len() as u64)
}

/// Compute price for a single constituent, trying primary window then fallbacks.
/// Spec: docs/methodology.md §6, docs/publisher.md §6.
pub async fn compute_constituent(
    _listings_by_window: Vec<(u32, Vec<SoldListing>)>,
    _config: &MethodologyConfig,
) -> Result<ConstituentResult> {
    // TODO:
    //   1. For each window in [primary, ...fallback]: apply_filters, check sample_size
    //   2. First window meeting min_sample_size → trimmed_mean → Computed
    //   3. If no window meets it → Stale with decayed_price
    unimplemented!("methodology pipeline: see docs/publisher.md §6")
}
