//! Scraper HTTP source.
//!
//! Calls the standalone `services/scraper` Node service (Oxylabs-backed eBay
//! search proxy, see services/scraper/src/index.ts) to fetch raw PSA 10 sold
//! listings for one constituent.  The scraper handles all the IP-rotation /
//! CAPTCHA / JS-rendering pain on its side; this source is just a thin HTTP
//! client.
//!
//! The wire format is intentionally identical to the Rust `SoldListing` struct
//! so the JSON deserializes one-to-one with no field remapping.  The remaining
//! filtering (PSA 10 regex, qualifier rejection, variant matching, trimmed
//! mean) happens downstream in `methodology::compute_constituent` — same code
//! path the `ebay_browse` source uses, so behavior between the two sources is
//! consistent once the listings arrive here.
//!
//! Config: pass the scraper service URL via the `SCRAPER_URL` env var OR the
//! `[sources.scraper].url` field in publisher.toml.

use super::{ConstituentQuery, PriceSource, SoldListing, TimeWindow};
use anyhow::{Context, Result};
use async_trait::async_trait;
use serde::Deserialize;
use std::time::Duration;

const DEFAULT_TIMEOUT_SECS: u64 = 90;

pub struct ScraperSource {
    base_url: String,
    client: reqwest::Client,
}

#[derive(Deserialize)]
struct ScrapeResponse {
    #[allow(dead_code)]
    query: String,
    listings: Vec<WireListing>,
    #[allow(dead_code)]
    scraped_in_ms: Option<u64>,
}

#[derive(Deserialize)]
struct WireListing {
    listing_id: String,
    raw_title: String,
    price_microusdc: u64,
    shipping_microusdc: u64,
    sold_at_unix: i64,
    source: String,
    // buyer_hash / seller_hash arrive as JSON null today — the scraper doesn't
    // attempt to identify counterparties.  Always `None` after deser; the
    // methodology pipeline doesn't use these fields, they exist for forensic
    // post-hoc analysis only.
    #[serde(default)]
    #[allow(dead_code)]
    buyer_hash: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    seller_hash: Option<String>,
}

impl ScraperSource {
    pub fn new(base_url: String) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECS))
                .build()
                .expect("reqwest::Client::build"),
        }
    }
}

#[async_trait]
impl PriceSource for ScraperSource {
    async fn fetch_listings(
        &self,
        constituent: &ConstituentQuery,
        _window: TimeWindow,
    ) -> Result<Vec<SoldListing>> {
        // The scraper returns the most-recent eBay sold-listings page without
        // a server-side date filter.  Window slicing happens in
        // methodology::compute_constituent (the Rust side), so we ignore
        // `_window` here and pull whatever eBay's current page shows.
        let q = urlencoding::encode(&constituent.canonical_search_string);
        let url = format!("{}/scrape?q={}", self.base_url, q);

        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .with_context(|| format!("scraper GET {url}"))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("scraper {} returned {}: {body}", url, status);
        }

        let parsed: ScrapeResponse = resp
            .json()
            .await
            .with_context(|| format!("decode scraper response from {url}"))?;

        Ok(parsed
            .listings
            .into_iter()
            .map(|w| SoldListing {
                listing_id: w.listing_id,
                price_microusdc: w.price_microusdc,
                sold_at_unix: w.sold_at_unix,
                source: w.source,
                raw_title: w.raw_title,
                // Wire `buyer_hash`/`seller_hash` are strings in the JSON
                // (when non-null) but our struct expects [u8; 32].  None for
                // now; if we ever need them, parse hex here.
                buyer_hash: None,
                seller_hash: None,
                shipping_microusdc: w.shipping_microusdc,
            })
            .collect())
    }

    fn name(&self) -> &'static str {
        "scraper"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_scraper_response_matches_wire_format() {
        // Pinned fixture matching the actual Railway scraper response shape.
        // If services/scraper changes its output, this test catches it.
        let body = r#"{
            "query": "Pokemon Charizard ex 199/165 SIR PSA 10",
            "listings": [
                {
                    "listing_id": "123456789",
                    "raw_title": "Pokemon 2023 Charizard ex 199/165 SIR Mew GEM MINT PSA 10",
                    "price_microusdc": 1775000000,
                    "shipping_microusdc": 0,
                    "sold_at_unix": 1779000000,
                    "source": "ebay_oxylabs",
                    "buyer_hash": null,
                    "seller_hash": null
                }
            ],
            "scraped_in_ms": 4562
        }"#;
        let parsed: ScrapeResponse =
            serde_json::from_str(body).expect("deserialize fixture");
        assert_eq!(parsed.listings.len(), 1);
        let l = &parsed.listings[0];
        assert_eq!(l.listing_id, "123456789");
        assert_eq!(l.price_microusdc, 1_775_000_000);
        assert_eq!(l.shipping_microusdc, 0);
        assert_eq!(l.source, "ebay_oxylabs");
    }
}
