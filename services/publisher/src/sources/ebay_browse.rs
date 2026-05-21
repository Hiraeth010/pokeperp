//! eBay Browse API source.
//!
//! Auth: OAuth2 client_credentials. Token is cached for its full lifetime (typically 2h);
//! we refresh ~5 minutes before expiry.
//!
//! Search endpoint: `/buy/browse/v1/item_summary/search` with `filter=soldItems` plus
//! the constituent's canonical query string. Results are paginated; we walk pages until
//! either eBay says we're done or items fall outside the requested window.
//!
//! NOTE: Production sold-listings access generally requires the Marketplace Insights API
//! (`/buy/marketplace_insights/v1_beta/item_sales/search`), which is partner-gated. The
//! Browse path here matches docs/publisher.md §5; swap the endpoint + parsing if you have
//! Marketplace Insights credentials.
//!
//! Spec: docs/publisher.md §5.

use super::{ConstituentQuery, PriceSource, SoldListing, TimeWindow};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Deserialize;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const DEFAULT_OAUTH_URL: &str = "https://api.ebay.com/identity/v1/oauth2/token";
const DEFAULT_BROWSE_URL: &str = "https://api.ebay.com/buy/browse/v1/item_summary/search";
const DEFAULT_SCOPE: &str = "https://api.ebay.com/oauth/api_scope";
const MARKETPLACE_US: &str = "EBAY_US";
const PAGE_LIMIT: u32 = 200;
const REFRESH_SKEW_SECS: u64 = 300;

pub struct EbayBrowseSource {
    app_id: String,
    cert_id: String,
    client: reqwest::Client,
    oauth_url: String,
    browse_url: String,
    scope: String,
    marketplace: String,
    token_cache: Mutex<Option<CachedToken>>,
}

struct CachedToken {
    access_token: String,
    /// Wall-clock instant when this token expires.
    expires_at: Instant,
}

impl EbayBrowseSource {
    pub fn new(app_id: String, cert_id: String, _rate_limit_rpm: u32) -> Self {
        Self::with_endpoints(
            app_id,
            cert_id,
            DEFAULT_OAUTH_URL.into(),
            DEFAULT_BROWSE_URL.into(),
            DEFAULT_SCOPE.into(),
            MARKETPLACE_US.into(),
        )
    }

    pub fn with_endpoints(
        app_id: String,
        cert_id: String,
        oauth_url: String,
        browse_url: String,
        scope: String,
        marketplace: String,
    ) -> Self {
        Self {
            app_id,
            cert_id,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .expect("reqwest::Client::build"),
            oauth_url,
            browse_url,
            scope,
            marketplace,
            token_cache: Mutex::new(None),
        }
    }

    /// Get a valid access token, refreshing if missing/expired.
    async fn access_token(&self) -> Result<String> {
        let mut guard = self.token_cache.lock().await;
        if let Some(cached) = guard.as_ref() {
            if cached.expires_at.saturating_duration_since(Instant::now())
                > Duration::from_secs(REFRESH_SKEW_SECS)
            {
                return Ok(cached.access_token.clone());
            }
        }
        let fresh = self.fetch_token().await?;
        let token = fresh.access_token.clone();
        *guard = Some(fresh);
        Ok(token)
    }

    async fn fetch_token(&self) -> Result<CachedToken> {
        let basic = B64.encode(format!("{}:{}", self.app_id, self.cert_id));
        let body = format!(
            "grant_type=client_credentials&scope={}",
            urlencoding::encode(&self.scope)
        );
        let resp = self
            .client
            .post(&self.oauth_url)
            .header("Authorization", format!("Basic {}", basic))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .context("ebay oauth POST")?;

        if !resp.status().is_success() {
            let status = resp.status();
            let txt = resp.text().await.unwrap_or_default();
            return Err(anyhow!("ebay oauth {}: {}", status, txt));
        }

        let parsed: OAuthResponse = resp.json().await.context("ebay oauth parse")?;
        Ok(CachedToken {
            access_token: parsed.access_token,
            expires_at: Instant::now() + Duration::from_secs(parsed.expires_in),
        })
    }

    /// Walk `item_summary/search` pages until eBay reports no `next` link
    /// OR the result set fully precedes `window.start_unix`.
    async fn search_all_pages(
        &self,
        query: &str,
        window: &TimeWindow,
    ) -> Result<Vec<EbayItemSummary>> {
        let token = self.access_token().await?;
        let mut offset = 0u32;
        let mut out: Vec<EbayItemSummary> = Vec::new();

        loop {
            let url = format!(
                "{}?q={}&filter=soldItems&limit={}&offset={}",
                self.browse_url,
                urlencoding::encode(query),
                PAGE_LIMIT,
                offset
            );
            let resp = self
                .client
                .get(&url)
                .header("Authorization", format!("Bearer {}", token))
                .header("X-EBAY-C-MARKETPLACE-ID", &self.marketplace)
                .send()
                .await
                .context("ebay browse GET")?;

            if !resp.status().is_success() {
                let status = resp.status();
                let txt = resp.text().await.unwrap_or_default();
                return Err(anyhow!("ebay browse {} @ offset={}: {}", status, offset, txt));
            }

            let page: BrowseSearchResponse = resp.json().await.context("ebay browse parse")?;
            let summaries = page.item_summaries.unwrap_or_default();
            if summaries.is_empty() {
                break;
            }

            let mut all_before_window = true;
            for s in &summaries {
                if let Some(sold) = s.sold_at_unix() {
                    if sold >= window.start_unix {
                        all_before_window = false;
                    }
                }
            }

            let page_len = summaries.len() as u32;
            out.extend(summaries);

            if all_before_window {
                break;
            }
            if page.next.is_none() || page_len < PAGE_LIMIT {
                break;
            }
            offset += PAGE_LIMIT;
            if offset >= 10_000 {
                // eBay Browse caps offset; bail out to avoid 400s.
                break;
            }
        }

        Ok(out)
    }
}

#[async_trait]
impl PriceSource for EbayBrowseSource {
    fn name(&self) -> &'static str {
        "ebay_browse"
    }

    async fn fetch_listings(
        &self,
        constituent: &ConstituentQuery,
        window: TimeWindow,
    ) -> Result<Vec<SoldListing>> {
        let summaries = self
            .search_all_pages(&constituent.canonical_search_string, &window)
            .await?;

        let mut out = Vec::with_capacity(summaries.len());
        for s in summaries {
            let Some(sold_at) = s.sold_at_unix() else {
                continue;
            };
            if sold_at < window.start_unix || sold_at > window.end_unix {
                continue;
            }
            let Some(price_micro) = s.price_microusdc() else {
                continue;
            };
            let shipping_micro = s.shipping_microusdc().unwrap_or(0);
            out.push(SoldListing {
                listing_id: s.item_id.unwrap_or_default(),
                price_microusdc: price_micro,
                sold_at_unix: sold_at,
                source: "ebay_browse".into(),
                raw_title: s.title.unwrap_or_default(),
                buyer_hash: None,
                seller_hash: None,
                shipping_microusdc: shipping_micro,
            });
        }
        Ok(out)
    }
}

#[derive(Deserialize, Debug)]
struct OAuthResponse {
    access_token: String,
    expires_in: u64,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct BrowseSearchResponse {
    item_summaries: Option<Vec<EbayItemSummary>>,
    next: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct EbayItemSummary {
    item_id: Option<String>,
    title: Option<String>,
    price: Option<EbayAmount>,
    shipping_options: Option<Vec<EbayShippingOption>>,
    /// Marketplace Insights returns `lastSoldDate`; Browse returns `itemEndDate`.
    item_end_date: Option<String>,
    last_sold_date: Option<String>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct EbayShippingOption {
    shipping_cost: Option<EbayAmount>,
}

#[derive(Deserialize, Debug)]
struct EbayAmount {
    value: String,
    currency: Option<String>,
}

impl EbayItemSummary {
    fn sold_at_unix(&self) -> Option<i64> {
        let raw = self
            .last_sold_date
            .as_deref()
            .or(self.item_end_date.as_deref())?;
        chrono::DateTime::parse_from_rfc3339(raw)
            .ok()
            .map(|dt| dt.timestamp())
    }

    fn price_microusdc(&self) -> Option<u64> {
        let p = self.price.as_ref()?;
        // Skip non-USD prices outright — methodology is USD-denominated.
        if let Some(cur) = &p.currency {
            if cur != "USD" {
                return None;
            }
        }
        parse_amount_micro(&p.value)
    }

    fn shipping_microusdc(&self) -> Option<u64> {
        let opt = self.shipping_options.as_ref()?.first()?;
        let amt = opt.shipping_cost.as_ref()?;
        if let Some(cur) = &amt.currency {
            if cur != "USD" {
                return None;
            }
        }
        parse_amount_micro(&amt.value)
    }
}

/// Parse a string like "1234.56" into micro-USDC (1 USDC = 1_000_000 micro).
fn parse_amount_micro(s: &str) -> Option<u64> {
    let trimmed = s.trim();
    let parsed: f64 = trimmed.parse().ok()?;
    if !parsed.is_finite() || parsed < 0.0 {
        return None;
    }
    Some((parsed * 1_000_000.0).round() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_amount_micro_handles_typical_values() {
        assert_eq!(parse_amount_micro("0.00"), Some(0));
        assert_eq!(parse_amount_micro("100.00"), Some(100_000_000));
        assert_eq!(parse_amount_micro("1234.56"), Some(1_234_560_000));
        assert_eq!(parse_amount_micro("  10.5 "), Some(10_500_000));
    }

    #[test]
    fn parse_amount_micro_rejects_garbage() {
        assert_eq!(parse_amount_micro(""), None);
        assert_eq!(parse_amount_micro("nope"), None);
        assert_eq!(parse_amount_micro("-5.00"), None);
    }

    #[test]
    fn sold_at_prefers_last_sold_date_over_item_end_date() {
        let s = EbayItemSummary {
            item_id: None,
            title: None,
            price: None,
            shipping_options: None,
            item_end_date: Some("2026-01-01T00:00:00Z".into()),
            last_sold_date: Some("2026-05-15T12:00:00Z".into()),
        };
        let t = s.sold_at_unix().unwrap();
        let expected = chrono::DateTime::parse_from_rfc3339("2026-05-15T12:00:00Z")
            .unwrap()
            .timestamp();
        assert_eq!(t, expected);
    }

    #[test]
    fn price_rejects_non_usd() {
        let s = EbayItemSummary {
            item_id: None,
            title: None,
            price: Some(EbayAmount {
                value: "100".into(),
                currency: Some("EUR".into()),
            }),
            shipping_options: None,
            item_end_date: None,
            last_sold_date: None,
        };
        assert_eq!(s.price_microusdc(), None);
    }
}
