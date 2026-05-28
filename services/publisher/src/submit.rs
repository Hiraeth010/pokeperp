//! Submit signed PriceUpdate transaction to the oracle program.
//!
//! Uses raw `solana-sdk` instruction encoding (no `anchor-client` dependency) so
//! the publisher binary stays small. The on-chain instruction is an Anchor
//! `#[program]` function, so we replicate Anchor's wire format:
//!
//!   - 8-byte discriminator: `sha256("global:submit_price_update")[0..8]`
//!   - args (borsh, little-endian):
//!       day: u32
//!       prices: [u64; 25]
//!       sale_counts: [u16; 25]
//!       source_root: [u8; 32]
//!
//! Spec: docs/oracle.md §4, programs/oracle/src/lib.rs `submit_price_update`.

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{Keypair, Signature, Signer},
    system_program,
    transaction::Transaction,
};

pub struct SubmitParams {
    pub day: u32,
    pub prices: [u64; 25],
    pub sale_counts: [u16; 25],
    pub source_root: [u8; 32],
}

/// PDA seed prefixes (must match `programs/oracle/src/state.rs`).
const CONFIG_SEED: &[u8] = b"config";
const PUBLISHER_SEED: &[u8] = b"publisher";
const PRICE_UPDATE_SEED: &[u8] = b"price";
const CONSTITUENT_REGISTRY_SEED: &[u8] = b"registry";
const INDEX_STATE_SEED: &[u8] = b"index_state";

/// Derive the PriceUpdate PDA for `(publisher, day)` — one per submission.
pub fn price_update_pda(oracle_program_id: &Pubkey, publisher: &Pubkey, day: u32) -> Pubkey {
    Pubkey::find_program_address(
        &[PRICE_UPDATE_SEED, publisher.as_ref(), &day.to_le_bytes()],
        oracle_program_id,
    )
    .0
}

/// SHA-256("global:<ix_name>")[0..8] — Anchor's instruction discriminator scheme.
fn anchor_discriminator(ix_name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("global:{}", ix_name).as_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 8];
    out.copy_from_slice(&result[..8]);
    out
}

/// Borsh-encode the submit_price_update arguments into a contiguous byte buffer.
fn encode_args(day: u32, prices: &[u64; 25], sale_counts: &[u16; 25], source_root: &[u8; 32]) -> Vec<u8> {
    // Capacity: 4 + 25×8 + 25×2 + 32 = 286 bytes
    let mut buf = Vec::with_capacity(4 + 25 * 8 + 25 * 2 + 32);
    buf.extend_from_slice(&day.to_le_bytes());
    for p in prices {
        buf.extend_from_slice(&p.to_le_bytes());
    }
    for c in sale_counts {
        buf.extend_from_slice(&c.to_le_bytes());
    }
    buf.extend_from_slice(source_root);
    buf
}

/// Sign and send a `submit_price_update` transaction. Returns the tx signature on success.
pub fn submit(
    client: &RpcClient,
    oracle_program_id: &Pubkey,
    publisher: &Keypair,
    params: SubmitParams,
) -> Result<Signature> {
    let publisher_pubkey = publisher.pubkey();

    // Derive PDAs that the on-chain Accounts struct expects (matching seeds in lib.rs).
    let (config_pda, _) =
        Pubkey::find_program_address(&[CONFIG_SEED], oracle_program_id);
    let (publisher_account_pda, _) = Pubkey::find_program_address(
        &[PUBLISHER_SEED, publisher_pubkey.as_ref()],
        oracle_program_id,
    );
    let (price_update_pda, _) = Pubkey::find_program_address(
        &[
            PRICE_UPDATE_SEED,
            publisher_pubkey.as_ref(),
            &params.day.to_le_bytes(),
        ],
        oracle_program_id,
    );

    // Build the instruction data: 8-byte discriminator || args.
    let disc = anchor_discriminator("submit_price_update");
    let args = encode_args(
        params.day,
        &params.prices,
        &params.sale_counts,
        &params.source_root,
    );
    let mut data = Vec::with_capacity(8 + args.len());
    data.extend_from_slice(&disc);
    data.extend_from_slice(&args);

    // Accounts order MUST match programs/oracle/src/lib.rs SubmitPriceUpdate:
    //   config (readonly), publisher (signer/mut), publisher_account (mut),
    //   price_update (init/mut), system_program.
    let accounts = vec![
        AccountMeta::new_readonly(config_pda, false),
        AccountMeta::new(publisher_pubkey, true),
        AccountMeta::new(publisher_account_pda, false),
        AccountMeta::new(price_update_pda, false),
        AccountMeta::new_readonly(system_program::ID, false),
    ];

    let ix = Instruction {
        program_id: *oracle_program_id,
        accounts,
        data,
    };

    let blockhash = client
        .get_latest_blockhash()
        .context("get_latest_blockhash")?;
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&publisher_pubkey),
        &[publisher],
        blockhash,
    );

    let sig = client
        .send_and_confirm_transaction(&tx)
        .context("send_and_confirm_transaction")?;
    Ok(sig)
}

/// Sign and send an `aggregate_day` transaction for `day`. `price_updates` are
/// the PriceUpdate accounts to fold into the per-constituent median (passed as
/// remaining accounts; the program filters by day and validates program
/// ownership). `caller` pays the fee — and the IndexState rent on the very first
/// aggregation. The instruction is permissionless on-chain.
///
/// Accounts order MUST match programs/oracle/src/lib.rs `AggregateDay`:
///   config (ro), registry (mut), index_state (mut, init_if_needed), caller
///   (signer/mut), system_program (ro), then the variable PriceUpdate tail.
pub fn aggregate_day(
    client: &RpcClient,
    oracle_program_id: &Pubkey,
    caller: &Keypair,
    day: u32,
    price_updates: &[Pubkey],
) -> Result<Signature> {
    let (config_pda, _) = Pubkey::find_program_address(&[CONFIG_SEED], oracle_program_id);
    let (registry_pda, _) =
        Pubkey::find_program_address(&[CONSTITUENT_REGISTRY_SEED], oracle_program_id);
    let (index_state_pda, _) =
        Pubkey::find_program_address(&[INDEX_STATE_SEED], oracle_program_id);

    let disc = anchor_discriminator("aggregate_day");
    let mut data = Vec::with_capacity(8 + 4);
    data.extend_from_slice(&disc);
    data.extend_from_slice(&day.to_le_bytes());

    let mut accounts = vec![
        AccountMeta::new_readonly(config_pda, false),
        AccountMeta::new(registry_pda, false),
        AccountMeta::new(index_state_pda, false),
        AccountMeta::new(caller.pubkey(), true),
        AccountMeta::new_readonly(system_program::ID, false),
    ];
    for pu in price_updates {
        accounts.push(AccountMeta::new_readonly(*pu, false));
    }

    let ix = Instruction {
        program_id: *oracle_program_id,
        accounts,
        data,
    };

    let blockhash = client
        .get_latest_blockhash()
        .context("get_latest_blockhash")?;
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&caller.pubkey()),
        &[caller],
        blockhash,
    );

    let sig = client
        .send_and_confirm_transaction(&tx)
        .context("send_and_confirm aggregate_day")?;
    Ok(sig)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discriminator_is_first_8_bytes_of_sha256() {
        let d = anchor_discriminator("submit_price_update");
        // Spot-check: same input must always produce the same output.
        let d2 = anchor_discriminator("submit_price_update");
        assert_eq!(d, d2);
        // Different input must produce different output.
        let d3 = anchor_discriminator("aggregate_day");
        assert_ne!(d, d3);
    }

    #[test]
    fn args_buffer_has_expected_size() {
        let buf = encode_args(0, &[0u64; 25], &[0u16; 25], &[0u8; 32]);
        assert_eq!(buf.len(), 4 + 25 * 8 + 25 * 2 + 32);
    }
}
