//! Methodology application (publisher-side).
//! Spec: docs/methodology.md §1/§3/§6/§9, docs/oracle.md §3, docs/publisher.md §6.

use crate::sources::SoldListing;
use regex::Regex;
use std::sync::LazyLock;

pub struct MethodologyConfig {
    pub trim_top_pct: u8,
    pub trim_bottom_pct: u8,
    pub min_sample_size: usize,
    pub window_days_primary: u32,
    pub window_days_fallback: Vec<u32>,
}

#[derive(Debug)]
pub struct Computed {
    pub price_microusdc: u64,
    pub sample_count: u16,
    pub window_days_used: u32,
    pub leaves: Vec<SoldListing>,
}

/// Apply mandatory publisher-side title/listing filters.
/// Spec: docs/methodology.md §1, docs/oracle.md §3.
pub fn apply_filters(listings: Vec<SoldListing>, variant_code: &str) -> Vec<SoldListing> {
    listings
        .into_iter()
        .filter(title_contains_psa_10_clean)
        .filter(title_is_english)
        .filter(|l| variant_matches(&l.raw_title, variant_code))
        .filter(shipping_ratio_ok)
        .collect()
}

/// `\bPSA[ -]?10\b` (case-insensitive) AND no qualifier code (OC/ST/MK/PD/MC) in any common position.
/// Spec: docs/methodology.md §1.
fn title_contains_psa_10_clean(l: &SoldListing) -> bool {
    PSA_10_RE.is_match(&l.raw_title) && !PSA_10_QUALIFIER_RE.is_match(&l.raw_title)
}

/// Reject titles containing CJK characters (Han / Hiragana / Katakana / Hangul).
/// Spec: docs/methodology.md §1 (English only).
fn title_is_english(l: &SoldListing) -> bool {
    !l.raw_title.chars().any(is_cjk)
}

/// Variant keyword check. variant_code is the registry's short tag (AA, SIR, SAR, RR, TG, VMAX, …).
/// Empty variant_code disables this check.
/// Spec: docs/methodology.md §9.3, §9.8.
fn variant_matches(title: &str, variant_code: &str) -> bool {
    let code = variant_code.trim();
    if code.is_empty() {
        return true;
    }
    let title_lc = title.to_lowercase();
    let synonyms = variant_synonyms(code);
    synonyms.iter().any(|s| title_lc.contains(*s))
}

/// Map a registry variant code to the set of acceptable title keywords.
/// Multiple synonyms reflect how sellers actually write listings (per docs/methodology.md §9.3).
fn variant_synonyms(code: &str) -> Vec<&'static str> {
    match code.to_ascii_uppercase().as_str() {
        "AA" => vec!["alt art", "alternate art"],
        "SIR" | "SAR" => vec![
            "sir",
            "sar",
            "special illustration",
            "special art",
            "alt art",
        ],
        "RR" | "RAINBOW" => vec!["rainbow", "secret"],
        "TG" | "TRAINER" => vec!["trainer gallery", "tg"],
        "GG" | "GALAR" => vec!["galarian gallery", "gg"],
        "VMAX" => vec!["vmax"],
        "VSTAR" => vec!["vstar"],
        "V" => vec![" v ", " v\n", " v/", " v "],
        "EX" => vec![" ex "],
        "GX" => vec!["gx"],
        _ => vec![],
    }
}

/// Drop listings where shipping > 0.5 × item price.
/// Spec: docs/oracle.md §3 mandatory filters.
fn shipping_ratio_ok(l: &SoldListing) -> bool {
    if l.price_microusdc == 0 {
        return false;
    }
    l.shipping_microusdc.saturating_mul(2) <= l.price_microusdc
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3040..=0x309F  // Hiragana
        | 0x30A0..=0x30FF // Katakana
        | 0x4E00..=0x9FFF // CJK Unified Ideographs
        | 0xAC00..=0xD7AF // Hangul Syllables
        | 0x3400..=0x4DBF // CJK Extension A
        | 0xF900..=0xFAFF // CJK Compatibility Ideographs
    )
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
    let sum: u128 = trimmed.iter().map(|p| *p as u128).sum();
    Some((sum / trimmed.len() as u128) as u64)
}

/// Run the full per-constituent computation:
/// filter once, then for each window (primary → fallbacks) restrict by sold_at,
/// check sample size, trim, mean. Return None if no window has ≥ min_sample_size.
///
/// `all_listings` should be every listing in the widest window the publisher fetched;
/// recency filtering happens here so the caller doesn't have to re-fetch per window.
/// Spec: docs/methodology.md §6, docs/publisher.md §6.
pub fn compute_constituent(
    all_listings: Vec<SoldListing>,
    variant_code: &str,
    now_unix: i64,
    config: &MethodologyConfig,
) -> Option<Computed> {
    let filtered = apply_filters(all_listings, variant_code);

    let mut windows = vec![config.window_days_primary];
    windows.extend(config.window_days_fallback.iter().copied());

    for window_days in windows {
        let cutoff = now_unix - (window_days as i64) * 86_400;
        let in_window: Vec<SoldListing> = filtered
            .iter()
            .filter(|l| l.sold_at_unix >= cutoff)
            .cloned()
            .collect();

        if in_window.len() < config.min_sample_size {
            continue;
        }

        let prices: Vec<u64> = in_window.iter().map(|l| l.price_microusdc).collect();
        if let Some(mean) = trimmed_mean(&prices, config.trim_top_pct, config.trim_bottom_pct) {
            return Some(Computed {
                price_microusdc: mean,
                sample_count: in_window.len() as u16,
                window_days_used: window_days,
                leaves: in_window,
            });
        }
    }
    None
}

/// Compute stale-fallback decayed price.
/// Spec: docs/publisher.md §4 stale_decay_pct_per_day.
pub fn apply_decay(base_price_microusdc: u64, days_since_fresh: u32, decay_pct_per_day: f64) -> u64 {
    let factor = (1.0 - decay_pct_per_day / 100.0 * days_since_fresh as f64).max(0.0);
    (base_price_microusdc as f64 * factor) as u64
}

// PSA 10 detection: bare "PSA 10" (or "PSA-10", "PSA10"), word-bounded so "PSA 100" doesn't match.
static PSA_10_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bpsa[\s\-]?10\b").expect("PSA_10_RE"));

// Qualifier suffix: PSA 10 immediately followed (optionally bracketed) by one of OC/ST/MK/PD/MC.
// Catches "PSA 10 OC", "PSA 10(OC)", "PSA 10 - OC", "PSA10 MC".
static PSA_10_QUALIFIER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bpsa[\s\-]?10[\s\-\(]*\(?(oc|st|mk|pd|mc)\)?\b").expect("PSA_10_QUALIFIER_RE")
});

#[cfg(test)]
mod tests {
    use super::*;

    fn mk(title: &str, price: u64, shipping: u64, sold_at: i64) -> SoldListing {
        SoldListing {
            listing_id: format!("{}-{}", title.len(), price),
            price_microusdc: price,
            sold_at_unix: sold_at,
            source: "test".into(),
            raw_title: title.into(),
            buyer_hash: None,
            seller_hash: None,
            shipping_microusdc: shipping,
        }
    }

    #[test]
    fn psa_10_clean_accepts_common_forms() {
        for title in [
            "Charizard VMAX 074/073 Rainbow Rare PSA 10",
            "Lugia V Alt Art 186/195 PSA-10 Silver Tempest",
            "Umbreon VMAX 215/203 Alt Art PSA10 GEM MINT",
        ] {
            assert!(
                title_contains_psa_10_clean(&mk(title, 1, 0, 0)),
                "expected accept: {title}"
            );
        }
    }

    #[test]
    fn psa_10_rejects_qualifier_codes() {
        for title in [
            "Charizard VMAX PSA 10 OC",
            "Lugia V Alt Art PSA10 ST",
            "Rayquaza PSA 10 (MK)",
            "Giratina V Alt Art PSA-10 MC",
        ] {
            assert!(
                !title_contains_psa_10_clean(&mk(title, 1, 0, 0)),
                "expected reject (qualifier): {title}"
            );
        }
    }

    #[test]
    fn psa_10_rejects_non_psa_10() {
        for title in [
            "Charizard PSA 9 GEM MINT",
            "Lugia BGS 10 Alt Art",
            "Rayquaza VMAX (no grade noted)",
            "Charizard PSA 100 special print",
        ] {
            assert!(
                !title_contains_psa_10_clean(&mk(title, 1, 0, 0)),
                "expected reject: {title}"
            );
        }
    }

    #[test]
    fn english_only_rejects_cjk() {
        assert!(!title_is_english(&mk(
            "リザードン VMAX PSA 10 Charizard",
            1,
            0,
            0
        )));
        assert!(!title_is_english(&mk("烈空坐 PSA 10 Rayquaza", 1, 0, 0)));
        assert!(title_is_english(&mk("Charizard VMAX PSA 10", 1, 0, 0)));
    }

    #[test]
    fn variant_matches_alt_art() {
        assert!(variant_matches("Lugia V Alt Art 186/195 PSA 10", "AA"));
        assert!(variant_matches(
            "Lugia V Alternate Art 186/195 PSA 10",
            "AA"
        ));
        assert!(!variant_matches("Lugia V Holo 186/195 PSA 10", "AA"));
    }

    #[test]
    fn variant_matches_sir() {
        assert!(variant_matches(
            "Charizard ex 199/165 SIR Special Illustration Rare PSA 10",
            "SIR"
        ));
        assert!(variant_matches(
            "Charizard ex 199/165 Alt Art PSA 10",
            "SIR"
        ));
        assert!(!variant_matches("Charizard ex 199/165 Holo PSA 10", "SIR"));
    }

    #[test]
    fn variant_empty_disables_check() {
        assert!(variant_matches("anything", ""));
    }

    #[test]
    fn shipping_filter_rejects_high_shipping() {
        // shipping > 50% of price → drop
        assert!(!shipping_ratio_ok(&mk("PSA 10 card", 100, 60, 0)));
        // shipping exactly 50% → keep (≤ rule)
        assert!(shipping_ratio_ok(&mk("PSA 10 card", 100, 50, 0)));
        assert!(shipping_ratio_ok(&mk("PSA 10 card", 100, 0, 0)));
        // price = 0 → drop
        assert!(!shipping_ratio_ok(&mk("PSA 10 card", 0, 0, 0)));
    }

    #[test]
    fn trimmed_mean_drops_top_and_bottom() {
        let prices = vec![100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
        // 10% top + 10% bottom → drop 1 from each end → mean(200..900)
        let mean = trimmed_mean(&prices, 10, 10).unwrap();
        let expected = (200 + 300 + 400 + 500 + 600 + 700 + 800 + 900) / 8;
        assert_eq!(mean, expected);
    }

    #[test]
    fn trimmed_mean_empty_is_none() {
        assert_eq!(trimmed_mean(&[], 10, 10), None);
    }

    #[test]
    fn trimmed_mean_all_trimmed_is_none() {
        // n=2, trim 50/50 → top_trim=1, bottom_trim=1, no remainder
        assert_eq!(trimmed_mean(&[100, 200], 50, 50), None);
    }

    #[test]
    fn compute_constituent_uses_primary_window_when_sample_sufficient() {
        let now = 1_700_000_000i64;
        let day = 86_400i64;
        let mut listings = vec![];
        // 6 listings within last 7 days: $1000 each (days 0..5 inclusive)
        for i in 0..6 {
            listings.push(mk(
                "Charizard ex 199/165 Alt Art PSA 10",
                1_000_000_000,
                0,
                now - i * day,
            ));
        }
        // Old listings from 20+ days ago that should NOT count for primary window
        for i in 0..5 {
            listings.push(mk(
                "Charizard ex 199/165 Alt Art PSA 10",
                5_000_000_000,
                0,
                now - (20 + i) * day,
            ));
        }
        let cfg = MethodologyConfig {
            trim_top_pct: 10,
            trim_bottom_pct: 10,
            min_sample_size: 5,
            window_days_primary: 7,
            window_days_fallback: vec![14, 30],
        };
        let result = compute_constituent(listings, "SIR", now, &cfg).unwrap();
        assert_eq!(result.window_days_used, 7);
        assert_eq!(result.sample_count, 6);
        assert_eq!(result.price_microusdc, 1_000_000_000);
    }

    #[test]
    fn compute_constituent_falls_back_to_wider_window() {
        let now = 1_700_000_000i64;
        let day = 86_400i64;
        // Only 2 in last 7 days (below min_sample=5), but 6 more within 14 days
        let mut listings = vec![];
        for i in 0..2 {
            listings.push(mk(
                "Lugia V Alt Art 186/195 PSA 10",
                1_500_000_000,
                0,
                now - i * day,
            ));
        }
        for i in 0..6 {
            listings.push(mk(
                "Lugia V Alt Art 186/195 PSA 10",
                1_500_000_000,
                0,
                now - (8 + i) * day,
            ));
        }
        let cfg = MethodologyConfig {
            trim_top_pct: 10,
            trim_bottom_pct: 10,
            min_sample_size: 5,
            window_days_primary: 7,
            window_days_fallback: vec![14, 30],
        };
        let result = compute_constituent(listings, "AA", now, &cfg).unwrap();
        assert_eq!(result.window_days_used, 14);
        assert_eq!(result.sample_count, 8);
    }

    #[test]
    fn compute_constituent_returns_none_when_no_window_meets_min() {
        let now = 1_700_000_000i64;
        let listings = vec![mk(
            "Lugia V Alt Art 186/195 PSA 10",
            1_500_000_000,
            0,
            now,
        )];
        let cfg = MethodologyConfig {
            trim_top_pct: 10,
            trim_bottom_pct: 10,
            min_sample_size: 5,
            window_days_primary: 7,
            window_days_fallback: vec![14, 30],
        };
        assert!(compute_constituent(listings, "AA", now, &cfg).is_none());
    }

    #[test]
    fn decay_zero_days_returns_base() {
        assert_eq!(apply_decay(1_000_000_000, 0, 0.5), 1_000_000_000);
    }

    #[test]
    fn decay_clamps_to_zero() {
        // 0.5% × 1000 days = 500% → clamp to 0
        assert_eq!(apply_decay(1_000_000_000, 1000, 0.5), 0);
    }

    #[test]
    fn decay_typical_case() {
        // 10 days × 0.5% = 5% off
        let out = apply_decay(1_000_000_000, 10, 0.5);
        // Allow small floating-point variance
        assert!((out as i64 - 950_000_000i64).abs() < 1000);
    }
}
