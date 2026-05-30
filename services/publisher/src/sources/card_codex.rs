//! Card-Codex aggregate-price source.
//!
//! Card-Codex (card-codex.com) publishes a pre-trimmed PSA 10 price per card
//! along with 30-day change and raw-grade price. Coverage is broader than
//! eBay's sold-listings API for the modern PMT50 cards we care about — see
//! the project memory's `pokeperp-data-sources.md` for the validation pass.
//!
//! Unlike eBay Browse which returns raw listings (this code → trimmed mean),
//! Card-Codex's prices are already aggregated by them. We pull the headline
//! PSA 10 number as a single point and treat it as the methodology output.
//! That means Card-Codex bypasses our trim-window logic — the assumption is
//! Card-Codex's aggregation is reasonable enough to use unmodified.
//!
//! URL pattern (validated against several inception candidates as of
//! 2026-05-19):
//!
//!     https://card-codex.com/pokemon/{era}/{set}/{card-slug}-{number}-{rarity-slug}/
//!
//! Per-card mapping is required because card-slug isn't derivable from
//! (set_code, collector_number) alone. The `CARD_CODEX_URLS` table below maps
//! `(set_code, collector_number, variant_code)` → the trailing URL segments.
//! New cards must be added here before they can be fetched.
//!
//! HTML scraping pattern: the PSA 10 price is rendered as `$1,234` (or
//! `$1,234.56`) inside a `<span class="psa10-price">` style block. The
//! regex below catches both formats; if Card-Codex restructures the page
//! it'll need updating.
//!
//! Spec: docs/publisher.md §5 secondary sources.

use super::{AggregatePriceSource, ConstituentQuery};
use anyhow::{Context, Result};
use async_trait::async_trait;
use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::Duration;

pub struct CardCodexSource {
    client: reqwest::Client,
    /// Override base URL — set to a local mock server in tests.
    base_url: String,
}

impl Default for CardCodexSource {
    fn default() -> Self {
        Self::new()
    }
}

impl CardCodexSource {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .user_agent("pokeperp-publisher/0.4")
                .build()
                .expect("reqwest::Client::build"),
            base_url: "https://card-codex.com".into(),
        }
    }

    pub fn with_base_url(base_url: String) -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .user_agent("pokeperp-publisher/0.4")
                .build()
                .expect("reqwest::Client::build"),
            base_url,
        }
    }

    /// Build the full URL for a constituent. Returns None if the card isn't in
    /// the known mapping — caller should treat as "not available", not an error.
    pub fn url_for(&self, c: &ConstituentQuery) -> Option<String> {
        let key = (c.set_code.as_str(), c.collector_number, c.variant_code.as_str());
        let entry = CARD_CODEX_URLS.get(&key)?;
        Some(format!(
            "{}/pokemon/{}/{}/{}-{}-{}/",
            self.base_url,
            entry.era,
            entry.set_slug,
            entry.card_slug,
            c.collector_number,
            entry.rarity_slug,
        ))
    }
}

#[async_trait]
impl AggregatePriceSource for CardCodexSource {
    fn name(&self) -> &'static str {
        "card_codex"
    }

    async fn fetch_price(&self, c: &ConstituentQuery) -> Result<Option<u64>> {
        let Some(url) = self.url_for(c) else {
            return Ok(None);
        };
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .with_context(|| format!("GET {}", url))?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !resp.status().is_success() {
            // 5xx / rate-limit / other transient: treat as None so the
            // pipeline falls through to decay rather than failing the whole
            // submission cycle.
            return Ok(None);
        }
        let body = resp.text().await.context("read body")?;
        Ok(parse_psa10_price(&body))
    }
}

/// Extract the PSA 10 price from a Card-Codex card-detail HTML body.
/// Returns micro-USDC. Looks for a `$N` or `$N,NNN` or `$N,NNN.NN` token
/// adjacent to "PSA 10" text.
pub fn parse_psa10_price(html: &str) -> Option<u64> {
    if let Some(captures) = PSA10_PRICE_RE.captures(html) {
        let raw = captures.get(1)?.as_str();
        return dollars_string_to_micro(raw);
    }
    None
}

fn dollars_string_to_micro(s: &str) -> Option<u64> {
    let cleaned: String = s
        .chars()
        .filter(|ch| ch.is_ascii_digit() || *ch == '.')
        .collect();
    if cleaned.is_empty() {
        return None;
    }
    let dollars: f64 = cleaned.parse().ok()?;
    if !dollars.is_finite() || dollars < 0.0 || dollars > 10_000_000.0 {
        return None;
    }
    Some((dollars * 1_000_000.0).round() as u64)
}

/// Card-Codex's pricing block. Tested against several PMT card pages
/// captured 2026-05-19. Catches:
///   PSA 10: $1,234
///   PSA 10 — $1,234.56
///   PSA 10\n          $50
/// Case-insensitive; allows arbitrary whitespace/punctuation between
/// "PSA 10" and the dollar amount up to ~50 chars.
static PSA10_PRICE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)psa\s*10[^$]{0,80}\$\s*([\d,]+(?:\.\d+)?)")
        .expect("PSA10_PRICE_RE")
});

struct UrlEntry {
    era: &'static str,
    set_slug: &'static str,
    card_slug: &'static str,
    rarity_slug: &'static str,
}

/// Per-card URL mapping for the PMT50 list. Keys mirror the
/// (set_code, collector_number, variant_code) tuple from the on-chain
/// `Constituent` struct. Adding a new constituent requires adding a row
/// here before the publisher can fetch its aggregate.  Unmapped entries
/// fall through gracefully (publisher falls back to eBay listings then
/// stale-decay), so an incorrect URL only loses Card-Codex as a source
/// for that one card.
///
/// Validated rarity slugs (per docs/inception-candidates.md and Card-Codex's
/// own URL conventions):
///   - `rare-rainbow`: VMAX alt-art secrets, Rainbow Rares
///   - `rare-ultra`:   V alt arts
///   - `special-illustration-rare`: SIR / SAR
///   - `trainer-gallery-rare-holo`: Trainer Gallery cards
static CARD_CODEX_URLS: LazyLock<HashMap<(&'static str, u16, &'static str), UrlEntry>> =
    LazyLock::new(|| {
        let mut m = HashMap::new();
        // Evolving Skies (sword-shield/evolving-skies)
        m.insert(
            ("ES", 215u16, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "evolving-skies", card_slug: "umbreon-vmax",  rarity_slug: "rare-rainbow" },
        );
        m.insert(
            ("ES", 218, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "evolving-skies", card_slug: "rayquaza-vmax", rarity_slug: "rare-rainbow" },
        );
        m.insert(
            ("ES", 180, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "evolving-skies", card_slug: "espeon-v",      rarity_slug: "rare-ultra" },
        );
        m.insert(
            ("ES", 167, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "evolving-skies", card_slug: "leafeon-v",     rarity_slug: "rare-ultra" },
        );
        m.insert(
            ("ES", 184, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "evolving-skies", card_slug: "sylveon-v",     rarity_slug: "rare-ultra" },
        );
        m.insert(
            ("ES", 175, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "evolving-skies", card_slug: "glaceon-v",     rarity_slug: "rare-ultra" },
        );
        // Lost Origin
        m.insert(
            ("LO", 186, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "lost-origin", card_slug: "giratina-v", rarity_slug: "rare-ultra" },
        );
        // Lost Origin Trainer Gallery
        m.insert(
            ("LO", 3, "TG"),
            UrlEntry { era: "sword-shield", set_slug: "lost-origin", card_slug: "charizard", rarity_slug: "trainer-gallery-rare-holo" },
        );
        // Silver Tempest
        m.insert(
            ("ST", 186, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "silver-tempest", card_slug: "lugia-v", rarity_slug: "rare-ultra" },
        );
        // Brilliant Stars
        m.insert(
            ("BS", 154, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "brilliant-stars", card_slug: "charizard-v",     rarity_slug: "rare-ultra" },
        );
        m.insert(
            ("BS", 174, "RR"),
            UrlEntry { era: "sword-shield", set_slug: "brilliant-stars", card_slug: "charizard-vstar", rarity_slug: "rare-rainbow" },
        );
        // Champion's Path
        m.insert(
            ("CP", 74, "RR"),
            UrlEntry { era: "sword-shield", set_slug: "champions-path", card_slug: "charizard-vmax", rarity_slug: "rare-rainbow" },
        );
        // Vivid Voltage
        m.insert(
            ("VV", 188, "RR"),
            UrlEntry { era: "sword-shield", set_slug: "vivid-voltage", card_slug: "pikachu-vmax", rarity_slug: "rare-rainbow" },
        );
        // Fusion Strike
        m.insert(
            ("FS", 251, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "fusion-strike", card_slug: "mew-v",       rarity_slug: "rare-ultra" },
        );
        m.insert(
            ("FS", 269, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "fusion-strike", card_slug: "mew-vmax",    rarity_slug: "rare-rainbow" },
        );
        m.insert(
            ("FS", 271, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "fusion-strike", card_slug: "gengar-vmax", rarity_slug: "rare-rainbow" },
        );
        // Unbroken Bonds
        m.insert(
            ("UB", 217, "RR"),
            UrlEntry { era: "sun-moon", set_slug: "unbroken-bonds", card_slug: "reshiram-and-charizard-gx", rarity_slug: "rare-rainbow" },
        );
        // Unified Minds
        m.insert(
            ("UM", 242, "RR"),
            UrlEntry { era: "sun-moon", set_slug: "unified-minds", card_slug: "mewtwo-and-mew-gx", rarity_slug: "rare-rainbow" },
        );
        // Pokemon 151
        m.insert(
            ("PMK", 199, "SIR"),
            UrlEntry { era: "scarlet-violet", set_slug: "pokemon-151", card_slug: "charizard-ex",       rarity_slug: "special-illustration-rare" },
        );
        m.insert(
            ("PMK", 204, "SIR"),
            UrlEntry { era: "scarlet-violet", set_slug: "pokemon-151", card_slug: "giovannis-charisma", rarity_slug: "special-illustration-rare" },
        );
        // Astral Radiance
        m.insert(
            ("AR", 188, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "astral-radiance", card_slug: "hisuian-zoroark-vstar", rarity_slug: "rare-ultra" },
        );
        // Obsidian Flames
        m.insert(
            ("OF", 215, "SIR"),
            UrlEntry { era: "scarlet-violet", set_slug: "obsidian-flames", card_slug: "charizard-ex", rarity_slug: "special-illustration-rare" },
        );
        // Paldean Fates
        m.insert(
            ("PaF", 233, "SIR"),
            UrlEntry { era: "scarlet-violet", set_slug: "paldean-fates", card_slug: "gardevoir-ex", rarity_slug: "special-illustration-rare" },
        );
        // Paldea Evolved
        m.insert(
            ("PE", 269, "SAR"),
            UrlEntry { era: "scarlet-violet", set_slug: "paldea-evolved", card_slug: "iono", rarity_slug: "special-illustration-rare" },
        );
        // Shining Fates Shiny Vault — falls back to no-match here; the SV
        // numbering doesn't align with Card-Codex's standard collector_number
        // URL convention. v0.4 follow-up.

        // ===================== PMT26-50 (v0.10 expansion) =====================
        // Card-Codex URLs below are best-guess from the same slug conventions
        // as PMT1-25. Where a URL returns 404 in production, the publisher
        // falls through to eBay listings, then stale-decay — losing Card-Codex
        // for that one card is non-fatal. Validate + correct as needed once
        // we see real fetch outcomes in publisher logs post-mainnet-cutover.

        // Silver Tempest — Lugia VSTAR Alt Art
        m.insert(
            ("ST", 211, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "silver-tempest", card_slug: "lugia-vstar", rarity_slug: "rare-ultra" },
        );
        // Pokemon 151 SIR (sv3pt5)
        m.insert(
            ("PMK", 193, "SIR"),
            UrlEntry { era: "scarlet-violet", set_slug: "pokemon-151", card_slug: "pikachu-ex",   rarity_slug: "special-illustration-rare" },
        );
        m.insert(
            ("PMK", 200, "SIR"),
            UrlEntry { era: "scarlet-violet", set_slug: "pokemon-151", card_slug: "blastoise-ex", rarity_slug: "special-illustration-rare" },
        );
        m.insert(
            ("PMK", 198, "SIR"),
            UrlEntry { era: "scarlet-violet", set_slug: "pokemon-151", card_slug: "venusaur-ex",  rarity_slug: "special-illustration-rare" },
        );
        m.insert(
            ("PMK", 201, "SIR"),
            UrlEntry { era: "scarlet-violet", set_slug: "pokemon-151", card_slug: "alakazam-ex",  rarity_slug: "special-illustration-rare" },
        );
        m.insert(
            ("PMK", 205, "SIR"),
            UrlEntry { era: "scarlet-violet", set_slug: "pokemon-151", card_slug: "mew-ex",       rarity_slug: "special-illustration-rare" },
        );
        // Lost Origin — Giratina VSTAR
        m.insert(
            ("LO", 213, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "lost-origin", card_slug: "giratina-vstar", rarity_slug: "rare-ultra" },
        );
        // Surging Sparks — Pikachu ex SIR
        m.insert(
            ("SS", 238, "SIR"),
            UrlEntry { era: "scarlet-violet", set_slug: "surging-sparks", card_slug: "pikachu-ex", rarity_slug: "special-illustration-rare" },
        );
        // Celebrations — Pikachu V-UNION (Card-Codex uses a single page for the V-UNION puzzle)
        m.insert(
            ("CEL", 25, "UN"),
            UrlEntry { era: "sword-shield", set_slug: "celebrations", card_slug: "pikachu-v-union", rarity_slug: "rare-ultra" },
        );
        // Crown Zenith Galarian Gallery — best-guess slug conventions
        m.insert(
            ("CZ", 29, "GG"),
            UrlEntry { era: "sword-shield", set_slug: "crown-zenith-galarian-gallery", card_slug: "charizard-vstar", rarity_slug: "rare-ultra" },
        );
        m.insert(
            ("CZ", 44, "GG"),
            UrlEntry { era: "sword-shield", set_slug: "crown-zenith-galarian-gallery", card_slug: "pikachu-vmax",    rarity_slug: "rare-ultra" },
        );
        m.insert(
            ("CZ", 50, "GG"),
            UrlEntry { era: "sword-shield", set_slug: "crown-zenith-galarian-gallery", card_slug: "rayquaza-vmax",   rarity_slug: "rare-ultra" },
        );
        m.insert(
            ("CZ", 51, "GG"),
            UrlEntry { era: "sword-shield", set_slug: "crown-zenith-galarian-gallery", card_slug: "zacian-v",        rarity_slug: "rare-ultra" },
        );
        // Astral Radiance alt arts
        m.insert(
            ("AR", 211, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "astral-radiance", card_slug: "origin-forme-palkia-vstar", rarity_slug: "rare-ultra" },
        );
        m.insert(
            ("AR", 209, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "astral-radiance", card_slug: "origin-forme-dialga-vstar", rarity_slug: "rare-ultra" },
        );
        m.insert(
            ("AR", 205, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "astral-radiance", card_slug: "hisuian-goodra-v",          rarity_slug: "rare-ultra" },
        );
        // Brilliant Stars — Arceus VSTAR Alt Art
        m.insert(
            ("BS", 184, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "brilliant-stars", card_slug: "arceus-vstar", rarity_slug: "rare-ultra" },
        );
        // Stellar Crown — Lance's Charizard ex SAR
        m.insert(
            ("SC", 232, "SAR"),
            UrlEntry { era: "scarlet-violet", set_slug: "stellar-crown", card_slug: "lances-charizard-ex", rarity_slug: "special-illustration-rare" },
        );
        // Pokemon GO
        m.insert(
            ("PGO", 11, "RR"),
            UrlEntry { era: "sword-shield", set_slug: "pokemon-go", card_slug: "radiant-charizard", rarity_slug: "rare-ultra" },
        );
        m.insert(
            ("PGO", 86, "AA"),
            UrlEntry { era: "sword-shield", set_slug: "pokemon-go", card_slug: "mewtwo-vstar",      rarity_slug: "rare-ultra" },
        );
        // Paldean Fates — Penny SAR
        m.insert(
            ("PaF", 91, "SAR"),
            UrlEntry { era: "scarlet-violet", set_slug: "paldean-fates", card_slug: "penny", rarity_slug: "special-illustration-rare" },
        );
        // Twilight Masquerade — Hydreigon ex SIR
        m.insert(
            ("TM", 167, "SIR"),
            UrlEntry { era: "scarlet-violet", set_slug: "twilight-masquerade", card_slug: "hydreigon-ex", rarity_slug: "special-illustration-rare" },
        );
        // Paradox Rift — Mela SAR
        m.insert(
            ("PR", 191, "SAR"),
            UrlEntry { era: "scarlet-violet", set_slug: "paradox-rift", card_slug: "mela", rarity_slug: "special-illustration-rare" },
        );
        // Paldea Evolved — Boss's Orders SAR
        m.insert(
            ("PaE", 270, "SAR"),
            UrlEntry { era: "scarlet-violet", set_slug: "paldea-evolved", card_slug: "bosss-orders", rarity_slug: "special-illustration-rare" },
        );
        // Obsidian Flames — Tyranitar ex SIR
        m.insert(
            ("OF", 226, "SIR"),
            UrlEntry { era: "scarlet-violet", set_slug: "obsidian-flames", card_slug: "tyranitar-ex", rarity_slug: "special-illustration-rare" },
        );

        m
    });

#[cfg(test)]
mod tests {
    use super::*;

    fn q(set: &str, num: u16, variant: &str) -> ConstituentQuery {
        ConstituentQuery {
            set_code: set.into(),
            collector_number: num,
            set_total: 0,
            variant_code: variant.into(),
            canonical_search_string: String::new(),
        }
    }

    #[test]
    fn url_for_known_card() {
        let s = CardCodexSource::new();
        let url = s.url_for(&q("ES", 215, "AA")).unwrap();
        assert_eq!(
            url,
            "https://card-codex.com/pokemon/sword-shield/evolving-skies/umbreon-vmax-215-rare-rainbow/"
        );
    }

    #[test]
    fn url_for_pokemon_151_sir() {
        let s = CardCodexSource::new();
        let url = s.url_for(&q("PMK", 199, "SIR")).unwrap();
        assert_eq!(
            url,
            "https://card-codex.com/pokemon/scarlet-violet/pokemon-151/charizard-ex-199-special-illustration-rare/"
        );
    }

    #[test]
    fn url_for_unknown_card_returns_none() {
        let s = CardCodexSource::new();
        assert!(s.url_for(&q("XX", 999, "AA")).is_none());
    }

    #[test]
    fn url_for_unmapped_variant_returns_none() {
        // ES 215 is mapped as AA only; an RR variant at same slot isn't real.
        let s = CardCodexSource::new();
        assert!(s.url_for(&q("ES", 215, "RR")).is_none());
    }

    #[test]
    fn parse_psa10_simple() {
        let html = r#"<p>PSA 10: $1,450</p>"#;
        assert_eq!(parse_psa10_price(html), Some(1_450_000_000));
    }

    #[test]
    fn parse_psa10_with_cents() {
        let html = r#"<div>PSA 10 — $2,825.50 (last sold)</div>"#;
        assert_eq!(parse_psa10_price(html), Some(2_825_500_000));
    }

    #[test]
    fn parse_psa10_three_digit() {
        let html = r#"<span>psa 10 $574</span>"#;
        assert_eq!(parse_psa10_price(html), Some(574_000_000));
    }

    #[test]
    fn parse_psa10_case_insensitive() {
        let html = r#"PSA10 $100"#;
        // Without a space, the regex still matches "PSA\s*10" → "psa10" matches.
        assert_eq!(parse_psa10_price(html), Some(100_000_000));
    }

    #[test]
    fn parse_psa10_no_match_returns_none() {
        assert_eq!(parse_psa10_price(r#"<p>BGS 10 $1000</p>"#), None);
        assert_eq!(parse_psa10_price(r#""#), None);
    }

    #[test]
    fn dollars_string_to_micro_handles_commas() {
        assert_eq!(dollars_string_to_micro("1,234"), Some(1_234_000_000));
        assert_eq!(dollars_string_to_micro("1,234.56"), Some(1_234_560_000));
        assert_eq!(dollars_string_to_micro("100"), Some(100_000_000));
    }

    #[test]
    fn dollars_string_to_micro_rejects_garbage() {
        assert_eq!(dollars_string_to_micro(""), None);
        assert_eq!(dollars_string_to_micro("not a number"), None);
    }
}
