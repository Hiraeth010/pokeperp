use anchor_lang::prelude::*;

#[error_code]
pub enum PerpError {
    #[msg("Trading is currently paused")]
    TradingPaused,
    #[msg("Funding is currently paused")]
    FundingPaused,
    #[msg("Position would exceed per-trader maximum")]
    PositionTooLarge,
    #[msg("Open interest cap would be exceeded on requested side")]
    OICapExceeded,
    #[msg("Insufficient margin for requested position")]
    InsufficientMargin,
    #[msg("Position is not currently liquidatable")]
    PositionNotLiquidatable,
    #[msg("Oracle index is not finalized for the current reference period")]
    OracleNotReady,
    #[msg("Oracle reports a stale index — trading restricted")]
    OracleStale,
    #[msg("Caller is not authorized")]
    Unauthorized,
    #[msg("Withdrawal would drop margin below initial-margin requirement")]
    WithdrawalBlockedByMargin,
    #[msg("Mark price deviation exceeds circuit-breaker threshold")]
    MarkPriceDeviation,
    #[msg("Insurance fund is below floor — ADL required")]
    InsuranceBelowFloor,
    #[msg("Market initialization parameters are invalid")]
    InvalidConfig,
    #[msg("Mark price computation overflowed or produced non-positive value")]
    MathOverflow,
    #[msg("Position size must be non-zero")]
    ZeroSize,
    #[msg("ADL ranking proof failed: witness position has higher PnL than candidate, or no witnesses provided")]
    ADLRankingFailed,
}
