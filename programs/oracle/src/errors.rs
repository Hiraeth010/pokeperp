use anchor_lang::prelude::*;

#[error_code]
pub enum OracleError {
    #[msg("Publisher is not in good standing")]
    PublisherNotActive,
    #[msg("Submission is outside the daily submission window")]
    SubmissionWindowClosed,
    #[msg("Publisher already submitted for this day")]
    DuplicateSubmission,
    #[msg("Fewer than the minimum number of publishers submitted")]
    InsufficientSubmissions,
    #[msg("Challenge window has closed")]
    ChallengeWindowClosed,
    #[msg("Challenge target submission does not exist")]
    ChallengeTargetMissing,
    #[msg("Bond deposit is insufficient")]
    InsufficientBond,
    #[msg("Caller is not authorized")]
    Unauthorized,
    #[msg("Price array contains an invalid value")]
    InvalidPrice,
    #[msg("Day has already been aggregated")]
    DayAlreadyAggregated,
    #[msg("Constituent registry version mismatch")]
    RegistryMismatch,
    #[msg("Oracle is currently paused")]
    OraclePaused,
    #[msg("Publisher is still in the shadow period")]
    PublisherInShadow,
    #[msg("Config initialization parameters are invalid")]
    InvalidConfig,
    #[msg("Submission day must equal current_day - 1")]
    InvalidSubmissionDay,
    #[msg("Challenge window still open — finalize requires elapsed challenge window")]
    ChallengeWindowOpen,
    #[msg("Index state is in unexpected status for this operation")]
    InvalidIndexStatus,
    #[msg("Slash basis points must be one of 1000 (10%), 5000 (50%), or 10000 (100%)")]
    InvalidSlashSeverity,
    #[msg("Protocol treasury vault has not been configured on Config")]
    TreasuryNotConfigured,
    #[msg("Protocol treasury vault account does not match Config")]
    TreasuryVaultMismatch,
    #[msg("Publisher bond vault account does not match Publisher record")]
    PublisherBondVaultMismatch,
    #[msg("Challenge target publisher does not match passed Publisher account")]
    ChallengeTargetMismatch,
}
