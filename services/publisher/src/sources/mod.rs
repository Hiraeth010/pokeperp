//! Price source abstraction. Each publisher chooses one primary + zero or more secondary sources.
//! Spec: docs/publisher.md §5.

pub mod ebay_browse;
pub mod pricecharting;

use anyhow::Result;
use async_trait::async_trait;

#[derive(Clone, Debug)]
pub struct TimeWindow {
    pub start_unix: i64,
    pub end_unix: i64,
}

/// Identifies a single constituent for the source to look up.
/// Mirrors the on-chain Constituent struct in programs/oracle/src/state.rs.
#[derive(Clone, Debug)]
pub struct ConstituentQuery {
    pub set_code: String,
    pub collector_number: u16,
    pub set_total: u16,
    pub variant_code: String,
    /// Off-chain canonical search string (hashed on-chain in `canonical_search_hash`).
    pub canonical_search_string: String,
}

/// A single PSA 10 sold listing fetched from a source.
#[derive(Clone, Debug)]
pub struct SoldListing {
    pub listing_id: String,
    pub price_microusdc: u64,
    pub sold_at_unix: i64,
    pub source: String,
    pub raw_title: String,
    pub buyer_hash: Option<[u8; 32]>,
    pub seller_hash: Option<[u8; 32]>,
    pub shipping_microusdc: u64,
}

#[async_trait]
pub trait PriceSource: Send + Sync {
    async fn fetch_listings(
        &self,
        constituent: &ConstituentQuery,
        window: TimeWindow,
    ) -> Result<Vec<SoldListing>>;

    fn name(&self) -> &'static str;
}
