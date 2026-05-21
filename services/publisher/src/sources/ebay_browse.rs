//! eBay Browse API source.
//! Spec: docs/publisher.md §5.

use super::{ConstituentQuery, PriceSource, SoldListing, TimeWindow};
use anyhow::Result;
use async_trait::async_trait;

pub struct EbayBrowseSource {
    pub app_id: String,
    pub cert_id: String,
    pub rate_limit_rpm: u32,
    pub client: reqwest::Client,
}

impl EbayBrowseSource {
    pub fn new(app_id: String, cert_id: String, rate_limit_rpm: u32) -> Self {
        Self {
            app_id,
            cert_id,
            rate_limit_rpm,
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl PriceSource for EbayBrowseSource {
    fn name(&self) -> &'static str {
        "ebay_browse"
    }

    async fn fetch_listings(
        &self,
        _constituent: &ConstituentQuery,
        _window: TimeWindow,
    ) -> Result<Vec<SoldListing>> {
        // TODO:
        //   1. Acquire OAuth token via cert_id (cache for token lifetime)
        //   2. GET /buy/browse/v1/item_summary/search with filter=soldItems and `q` = constituent.canonical_search_string
        //   3. Paginate through results constrained to window.start_unix..window.end_unix
        //   4. Parse each result into SoldListing (extract sold_at, price, shipping, title)
        //   5. Respect rate_limit_rpm with a token-bucket limiter
        Ok(vec![])
    }
}
