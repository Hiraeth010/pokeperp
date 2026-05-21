//! PriceCharting source (third-party aggregator).
//! Spec: docs/publisher.md §5.

use super::{ConstituentQuery, PriceSource, SoldListing, TimeWindow};
use anyhow::Result;
use async_trait::async_trait;

pub struct PriceChartingSource {
    pub api_key: String,
    pub client: reqwest::Client,
}

impl PriceChartingSource {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl PriceSource for PriceChartingSource {
    fn name(&self) -> &'static str {
        "pricecharting"
    }

    async fn fetch_listings(
        &self,
        _constituent: &ConstituentQuery,
        _window: TimeWindow,
    ) -> Result<Vec<SoldListing>> {
        // TODO:
        //   1. Look up product by canonical name → PriceCharting product ID
        //   2. Call /api/sales for that product with PSA 10 grade filter, restricted to window
        //   3. Parse each sale into SoldListing
        Ok(vec![])
    }
}
