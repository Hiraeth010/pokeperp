use anchor_lang::prelude::*;

/// Global config for the oracle program.
/// Spec: docs/oracle.md §2, §7, §8.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// v0.8 two-step admin transfer.  Same semantics as Market.pending_admin
    /// in perp-engine: propose_admin_transfer writes here, accept_admin_transfer
    /// (signed by the proposed admin) commits.  Sentinel for "no transfer in
    /// flight" is Pubkey::default().  Two-step protects against typos when
    /// handing authority to a Squads multisig vault.
    pub pending_admin: Pubkey,
    pub publisher_count: u8,
    pub publisher_bond: u64,
    pub challenge_bond: u64,
    pub phase: u8,
    pub min_publishers_per_day: u8,
    pub submission_window_start: u32,
    pub submission_window_end: u32,
    pub challenge_window_seconds: u32,
    pub paused: bool,
    pub pause_reason: u8,
    /// Protocol treasury USDC vault (perp-engine PDA). Set post-init via
    /// `set_protocol_treasury`. Slash + failed-challenge protocol cuts route here.
    /// Zero pubkey = not configured; resolve_challenge reverts until set.
    pub protocol_treasury_vault: Pubkey,
    pub bump: u8,
}

/// PDA seed for the singleton Config account.
pub const CONFIG_SEED: &[u8] = b"config";

/// Per-publisher record.
/// Spec: docs/oracle.md §2 (onboarding, removal), §7 (bonds, rewards, slashing).
#[account]
#[derive(InitSpace)]
pub struct Publisher {
    pub publisher_key: Pubkey,
    pub bond_amount: u64,
    pub bond_vault: Pubkey,
    pub status: PublisherStatus,
    pub joined_day: u32,
    pub shadow_period_days_remaining: u16,
    pub total_submissions: u64,
    pub successful_challenges_against: u32,
    pub last_submitted_day: u32,
    /// v0.9 liveness slashing: highest tier that has already been applied for
    /// the current absence gap.  0 = no liveness slash pending; 1/2/3 = the
    /// 5%/25%/100% tiers from oracle.md §7.  Resets to 0 whenever the publisher
    /// makes a successful submission, so each fresh absence gap can re-tier
    /// from scratch.  Prevents double-slashing the same gap if `slash_for_liveness`
    /// is cranked multiple times within a tier.
    pub last_liveness_slash_tier: u8,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PublisherStatus {
    Shadow,
    Active,
    Suspended,
    Removed,
}

/// PDA seed prefix for Publisher accounts: seeds = [PUBLISHER_SEED, publisher_key.as_ref()].
pub const PUBLISHER_SEED: &[u8] = b"publisher";

/// PDA seed prefix for per-publisher bond vault token accounts: seeds = [BOND_VAULT_SEED, publisher_key.as_ref()].
pub const BOND_VAULT_SEED: &[u8] = b"bond_vault";

/// The 25-entry constituent registry. Versioned at each rebalance.
/// Zero-copy because the array is ~1500 bytes — deserializing onto stack would
/// exceed Solana's 4KB stack frame in `try_accounts`.
/// Spec: docs/methodology.md §1, §5, §9.8.
#[account(zero_copy)]
#[repr(C)]
pub struct ConstituentRegistry {
    pub constituents: [Constituent; 25],
    pub version: u32,
    pub effective_day: u32,
    pub bump: u8,
    pub _pad: [u8; 7], // pad to 8-byte align (struct alignment dominated by u64 in Constituent)
}

/// A single constituent entry. Fields reordered (largest align first) to avoid
/// implicit padding, then explicit trailing `_pad` to make the type Pod-safe.
/// Spec: docs/methodology.md §1 (card identity), §9.8 (matching protocol).
#[zero_copy]
#[repr(C)]
#[derive(Default)]
pub struct Constituent {
    pub base_price: u64,                  // 8, align 8 — offset 0
    pub canonical_search_hash: [u8; 32],  // 32, align 1 — offset 8
    pub set_code: [u8; 8],                // 8, align 1 — offset 40
    pub variant_code: [u8; 8],            // 8, align 1 — offset 48
    pub collector_number: u16,            // 2, align 2 — offset 56
    pub set_total: u16,                   // 2, align 2 — offset 58
    pub _pad: [u8; 4],                    // explicit pad to 64 bytes total
}

/// Wire-format struct used as the `update_constituent` instruction parameter.
/// Necessary because Anchor 0.31's `#[zero_copy]` and `#[derive(AnchorSerialize)]`
/// both emit `IdlBuild` impls — they collide on the same type. We split the wire
/// format from the storage format.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct ConstituentInput {
    pub base_price: u64,
    pub canonical_search_hash: [u8; 32],
    pub set_code: [u8; 8],
    pub variant_code: [u8; 8],
    pub collector_number: u16,
    pub set_total: u16,
}

impl From<ConstituentInput> for Constituent {
    fn from(i: ConstituentInput) -> Self {
        Self {
            base_price: i.base_price,
            canonical_search_hash: i.canonical_search_hash,
            set_code: i.set_code,
            variant_code: i.variant_code,
            collector_number: i.collector_number,
            set_total: i.set_total,
            _pad: [0; 4],
        }
    }
}

/// PDA seed for the singleton ConstituentRegistry account.
pub const CONSTITUENT_REGISTRY_SEED: &[u8] = b"registry";

/// A publisher's daily price submission.
/// Spec: docs/oracle.md §4 submission format.
#[account]
#[derive(InitSpace)]
pub struct PriceUpdate {
    pub publisher: Pubkey,
    pub day: u32,
    pub prices: [u64; 25],
    pub sale_counts: [u16; 25],
    pub source_root: [u8; 32],
    pub submitted_at: i64,
    pub bump: u8,
}

/// PDA seed prefix for PriceUpdate accounts:
///   seeds = [PRICE_UPDATE_SEED, publisher_key.as_ref(), day.to_le_bytes()]
pub const PRICE_UPDATE_SEED: &[u8] = b"price";

/// Aggregated daily index state.
/// Spec: docs/oracle.md §5 aggregation, docs/methodology.md §7 index formula.
#[account]
#[derive(InitSpace)]
pub struct IndexState {
    pub day: u32,
    pub status: IndexStatus,
    pub aggregated_prices: [u64; 25],
    pub constituent_status: [u8; 25],
    pub index_value: u64,
    pub finalized_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum IndexStatus {
    Provisional,
    Final,
    Stale,
    Frozen,
}

/// PDA seed for the singleton IndexState account.
pub const INDEX_STATE_SEED: &[u8] = b"index_state";

/// An open or resolved challenge.
/// Spec: docs/oracle.md §6 dispute mechanism, §7 slashing.
#[account]
#[derive(InitSpace)]
pub struct Challenge {
    pub challenger: Pubkey,
    pub target_publisher: Pubkey,
    pub target_day: u32,
    pub target_constituent: u8,
    pub claimed_correct_price: u64,
    #[max_len(200)]
    pub evidence_uri: String,
    pub bond: u64,
    pub status: ChallengeStatus,
    pub opened_at: i64,
    pub resolved_at: i64,
    /// Set on success: basis points of publisher bond slashed (one of 1000/5000/10000
    /// per spec §7). Zero on failure or while open.
    pub slash_bps: u16,
    /// Set on success: absolute USDC amount transferred out of the publisher bond vault.
    /// Zero on failure or while open.
    pub slashed_amount: u64,
    /// Set on resolve: amount the challenger received. Success = bond refund + 50% of slash;
    /// failure = 0 (challenger's bond was redistributed).
    pub challenger_payout: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum ChallengeStatus {
    Open,
    Succeeded,
    Failed,
}

/// PDA seeds for challenge accounts. Each (challenger, day, constituent) tuple gets its own challenge.
pub const CHALLENGE_SEED: &[u8] = b"challenge";

/// PDA seed prefix for per-challenge bond escrow vaults:
///   [CHALLENGE_BOND_VAULT_SEED, challenger, day, constituent]
/// The challenger's USDC bond lives here from open_challenge to resolve_challenge.
pub const CHALLENGE_BOND_VAULT_SEED: &[u8] = b"challenge_bond_vault";
