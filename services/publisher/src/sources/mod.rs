//! Price source abstraction. Each publisher chooses one primary + zero or more secondary sources.
//! Spec: docs/publisher.md §5.

pub mod card_codex;
pub mod ebay_browse;
pub mod pricecharting;
pub mod scraper;

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

/// Aggregate-price source. Returns a single price per constituent rather than
/// raw listings — designed for sites that publish a pre-trimmed PSA 10 price
/// (Card-Codex, Pokeval, etc.) instead of individual sale records. The pipeline
/// falls back here when the primary listing-based source returns insufficient
/// samples to compute a trimmed mean.
///
/// `Ok(None)` means "queried successfully, but no price available" (404, card
/// not in mapping, etc). `Err` is reserved for transport / parse failures
/// where retrying might help.
#[async_trait]
pub trait AggregatePriceSource: Send + Sync {
    async fn fetch_price(
        &self,
        constituent: &ConstituentQuery,
    ) -> Result<Option<u64>>;

    fn name(&self) -> &'static str;
}
