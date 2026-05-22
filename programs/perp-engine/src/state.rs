use anchor_lang::prelude::*;

/// Perp market configuration and runtime state.
/// Spec: docs/perp-engine.md §2, §3 (mark price), §9 (caps & fees).
#[account]
#[derive(InitSpace)]
pub struct Market {
    pub admin: Pubkey,
    pub oracle_index_state: Pubkey,
    pub usdc_mint: Pubkey,
    pub insurance_fund: Pubkey,
    pub phase: u8,

    // Mark-price params (§3)
    pub slippage_factor: u32, // ×1e6 (100_000 = 0.10)
    pub oi_floor: u64,        // USDC notional, micro-USDC (100k = 100_000_000_000)

    // Open interest
    pub long_oi: u64,
    pub short_oi: u64,
    pub max_oi_per_side: u64,
    pub max_position_per_trader: u64,

    // Margin (§5)
    pub initial_margin_bps: u16, // 3300 = 33%
    pub maintenance_margin_bps: u16, // 1650 = 16.5%

    // Funding (§4)
    pub funding_cap_per_hour_bps: u16, // 10 = 0.10%
    pub last_funding_update: i64,
    pub cumulative_funding_long: i128,
    pub cumulative_funding_short: i128,

    // Mark TWAPs (computed on every trade)
    pub mark_twap_1h: u64,
    pub mark_twap_5min: u64,

    // Fees (§9)
    pub taker_fee_bps: u16,
    pub liquidation_penalty_bps: u16,

    // Circuit breakers (§10)
    pub trading_paused: bool,
    pub funding_paused: bool,
    pub pause_reason: u8,
    pub mark_deviation_exceeded_since: i64,

    pub bump: u8,
}

/// An open trader position. Isolated margin (§5).
/// Spec: docs/perp-engine.md §5, §6.
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub trader: Pubkey,
    pub market: Pubkey,
    pub size: i64,           // signed: + = long, - = short (base notional in micro-USDC)
    pub entry_index_price: u64,
    pub entry_mark_price: u64,
    pub margin_vault: Pubkey,
    pub cumulative_funding_snapshot: i128,
    pub opened_at: i64,
    pub bump: u8,
}

/// Insurance fund tracker (USDC vault).
/// Spec: docs/perp-engine.md §7.
#[account]
#[derive(InitSpace)]
pub struct InsuranceFund {
    pub vault: Pubkey,
    pub floor: u64,
    pub total_deposited: u64,
    pub total_paid_out: u64,
    pub bump: u8,
}

/// Protocol treasury — receives 90% of taker fees per spec §9 (insurance keeps
/// the remaining 10% as a backstop reserve). v0.2 routed 100% of fees to
/// insurance; the split landed in v0.3. Withdrawals from this vault are
/// out-of-scope for v0.3 — admin governance ix is a follow-up.
#[account]
#[derive(InitSpace)]
pub struct Treasury {
    pub vault: Pubkey,
    pub total_received: u64,
    pub bump: u8,
}

/// PDA seeds.
pub const MARKET_SEED: &[u8] = b"market";
pub const INSURANCE_FUND_SEED: &[u8] = b"insurance_fund";
pub const INSURANCE_VAULT_SEED: &[u8] = b"insurance_vault";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const TREASURY_VAULT_SEED: &[u8] = b"treasury_vault";
pub const POSITION_SEED: &[u8] = b"position";
pub const MARGIN_VAULT_SEED: &[u8] = b"margin_vault";
