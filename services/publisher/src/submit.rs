//! Submit signed PriceUpdate transaction to the oracle program.
//! Spec: docs/publisher.md §8, docs/oracle.md §4.

use anyhow::Result;
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signature},
};

pub struct SubmitParams {
    pub day: u32,
    pub prices: [u64; 25],
    pub sale_counts: [u16; 25],
    pub source_root: [u8; 32],
}

/// Sign and send a `submit_price_update` transaction.
/// Spec: docs/publisher.md §8, docs/oracle.md §4.
pub async fn submit(
    _client: &RpcClient,
    _oracle_program_id: &Pubkey,
    _keypair: &Keypair,
    _params: SubmitParams,
) -> Result<Signature> {
    // TODO:
    //   1. Derive publisher PDA (seeds = [b"publisher", keypair.pubkey()])
    //   2. Derive price_update PDA (seeds = [b"price", keypair.pubkey(), day.to_le_bytes()])
    //   3. Build instruction via anchor-client / manual encoding
    //   4. Sign and send with skip_preflight=false, commitment=confirmed
    //   5. Retry transient errors per docs/publisher.md §8 retry policy
    unimplemented!("submit not yet implemented — see docs/publisher.md §8")
}
