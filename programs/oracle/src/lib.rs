use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

pub mod errors;
pub mod state;

use errors::OracleError;
use state::*;

declare_id!("GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i");

#[program]
pub mod oracle {
    use super::*;

    /// Initialize global config. Admin = core multisig.
    /// Spec: docs/oracle.md §2 (publisher set), §7 (params), §8 (phasing).
    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        require!(
            params.submission_window_end > params.submission_window_start,
            OracleError::InvalidConfig
        );
        require!(
            params.submission_window_end <= 24 * 3600,
            OracleError::InvalidConfig
        );
        require!(params.min_publishers_per_day >= 1, OracleError::InvalidConfig);
        require!(params.publisher_bond > 0, OracleError::InvalidConfig);
        require!(params.challenge_bond > 0, OracleError::InvalidConfig);
        require!(
            params.challenge_window_seconds > 0,
            OracleError::InvalidConfig
        );

        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.publisher_count = 0;
        config.publisher_bond = params.publisher_bond;
        config.challenge_bond = params.challenge_bond;
        config.phase = 0; // Phase 0 = shadow (oracle.md §8).
        config.min_publishers_per_day = params.min_publishers_per_day;
        config.submission_window_start = params.submission_window_start;
        config.submission_window_end = params.submission_window_end;
        config.challenge_window_seconds = params.challenge_window_seconds;
        config.paused = false;
        config.pause_reason = 0;
        config.protocol_treasury_vault = Pubkey::default();
        config.bump = ctx.bumps.config;

        Ok(())
    }

    /// Wire the protocol treasury USDC vault (perp-engine PDA) into oracle Config.
    /// Admin-only. Must be set before any `resolve_challenge` can succeed, since
    /// both success and failure paths route a protocol cut into this vault.
    /// Called post-init once the perp-engine `initialize_treasury` has run.
    pub fn set_protocol_treasury(
        ctx: Context<SetProtocolTreasury>,
        treasury_vault: Pubkey,
    ) -> Result<()> {
        require!(treasury_vault != Pubkey::default(), OracleError::InvalidConfig);
        ctx.accounts.config.protocol_treasury_vault = treasury_vault;
        Ok(())
    }

    /// Register a publisher: admin approves, admin's USDC funds the 10k bond into a per-publisher vault PDA.
    /// New publisher enters in Shadow status with 30 shadow days remaining.
    /// Spec: docs/oracle.md §2 onboarding, §7 bonds.
    pub fn register_publisher(
        ctx: Context<RegisterPublisher>,
        publisher_key: Pubkey,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, OracleError::OraclePaused);

        let bond_amount = ctx.accounts.config.publisher_bond;
        require!(
            ctx.accounts.admin_usdc_account.amount >= bond_amount,
            OracleError::InsufficientBond
        );

        // Transfer bond from admin's USDC ATA to the per-publisher bond vault PDA.
        let cpi_accounts = Transfer {
            from: ctx.accounts.admin_usdc_account.to_account_info(),
            to: ctx.accounts.bond_vault.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        token::transfer(CpiContext::new(cpi_program, cpi_accounts), bond_amount)?;

        // Initialize Publisher record.
        let publisher = &mut ctx.accounts.publisher_account;
        publisher.publisher_key = publisher_key;
        publisher.bond_amount = bond_amount;
        publisher.bond_vault = ctx.accounts.bond_vault.key();
        publisher.status = PublisherStatus::Shadow;
        publisher.joined_day = current_unix_day()?;
        publisher.shadow_period_days_remaining = 30;
        publisher.total_submissions = 0;
        publisher.successful_challenges_against = 0;
        publisher.last_submitted_day = 0;
        publisher.bump = ctx.bumps.publisher_account;

        // Bump config's publisher counter.
        let config = &mut ctx.accounts.config;
        config.publisher_count = config
            .publisher_count
            .checked_add(1)
            .ok_or(OracleError::InvalidConfig)?;

        Ok(())
    }

    /// Promote publisher from shadow to active after 30-day shadow period.
    /// Spec: docs/oracle.md §2 onboarding (shadow period).
    pub fn activate_publisher(ctx: Context<ActivatePublisher>) -> Result<()> {
        require!(!ctx.accounts.config.paused, OracleError::OraclePaused);

        let publisher = &mut ctx.accounts.publisher_account;
        require!(
            publisher.status == PublisherStatus::Shadow,
            OracleError::PublisherNotActive
        );

        let current_day = current_unix_day()?;
        let elapsed_days = current_day.saturating_sub(publisher.joined_day);
        require!(elapsed_days >= 30, OracleError::PublisherInShadow);

        // Deviation threshold checks are off-chain (oracle.md §2) — admin attests by signing.
        publisher.status = PublisherStatus::Active;
        publisher.shadow_period_days_remaining = 0;
        Ok(())
    }

    /// Initialize the constituent registry to all-zero state.
    /// Caller then writes each slot via `update_constituent` (up to 25 calls), then
    /// commits with `finalize_registry_update`. Split from a single instruction because
    /// 25 × 64-byte Constituent payload exceeds Solana's 1232-byte tx data cap.
    /// Spec: docs/methodology.md §1, §5, §9.8.
    pub fn initialize_registry(ctx: Context<InitializeRegistry>) -> Result<()> {
        require!(!ctx.accounts.config.paused, OracleError::OraclePaused);
        let mut registry = ctx.accounts.registry.load_init()?;
        // Constituents are zero-initialized by AccountLoader's init.
        registry.version = 0; // 0 = not yet committed (first finalize_registry_update sets to 1)
        registry.effective_day = 0;
        registry.bump = ctx.bumps.registry;
        Ok(())
    }

    /// Update a single constituent slot in the registry.
    /// If the new (set_code, collector_number, variant_code) matches the prior entry
    /// at this slot, `base_price` is preserved (chain-linking per methodology §7).
    /// Spec: docs/methodology.md §9.8.
    pub fn update_constituent(
        ctx: Context<UpdateConstituent>,
        idx: u8,
        constituent: ConstituentInput,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, OracleError::OraclePaused);
        require!((idx as usize) < 25, OracleError::InvalidConfig);

        let mut new_c: Constituent = constituent.into();
        let mut registry = ctx.accounts.registry.load_mut()?;
        let i = idx as usize;

        let same_identity = registry.constituents[i].set_code == new_c.set_code
            && registry.constituents[i].collector_number == new_c.collector_number
            && registry.constituents[i].variant_code == new_c.variant_code;

        if same_identity {
            new_c.base_price = registry.constituents[i].base_price;
        }
        registry.constituents[i] = new_c;
        Ok(())
    }

    /// Commit version + effective_day after all slots are updated for a rebalance.
    /// Spec: docs/methodology.md §5 monthly rebalance.
    pub fn finalize_registry_update(
        ctx: Context<FinalizeRegistryUpdate>,
        effective_day: u32,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, OracleError::OraclePaused);
        let mut registry = ctx.accounts.registry.load_mut()?;
        registry.version = registry
            .version
            .checked_add(1)
            .ok_or(OracleError::InvalidConfig)?;
        registry.effective_day = effective_day;
        Ok(())
    }

    /// Submit a publisher's daily price update for the prior day (T-1).
    /// Spec: docs/oracle.md §4 submission format.
    pub fn submit_price_update(
        ctx: Context<SubmitPriceUpdate>,
        day: u32,
        prices: [u64; 25],
        sale_counts: [u16; 25],
        source_root: [u8; 32],
    ) -> Result<()> {
        let config = &ctx.accounts.config;

        require!(!config.paused, OracleError::OraclePaused);

        let publisher = &mut ctx.accounts.publisher_account;
        require!(
            publisher.status == PublisherStatus::Active
                || publisher.status == PublisherStatus::Shadow,
            OracleError::PublisherNotActive
        );

        let clock = Clock::get()?;
        let current_day = (clock.unix_timestamp / 86400) as u32;
        let seconds_into_day = clock.unix_timestamp.rem_euclid(86400) as u32;

        // Spec: §4 — submissions on day T are FOR day T-1.
        require!(
            current_day > 0 && day + 1 == current_day,
            OracleError::InvalidSubmissionDay
        );
        require!(
            seconds_into_day >= config.submission_window_start
                && seconds_into_day <= config.submission_window_end,
            OracleError::SubmissionWindowClosed
        );

        // Every reported price must be positive — methodology §6 stale fallback still emits
        // a positive decayed price, so a zero indicates a publisher data bug.
        for &p in prices.iter() {
            require!(p > 0, OracleError::InvalidPrice);
        }
        for &c in sale_counts.iter() {
            require!(c > 0, OracleError::InvalidPrice);
        }

        // Duplicate-submission prevention: the PriceUpdate PDA is seeded by (publisher, day),
        // so `init` fails atomically if the publisher already submitted for this day.

        let pu = &mut ctx.accounts.price_update;
        pu.publisher = publisher.publisher_key;
        pu.day = day;
        pu.prices = prices;
        pu.sale_counts = sale_counts;
        pu.source_root = source_root;
        pu.submitted_at = clock.unix_timestamp;
        pu.bump = ctx.bumps.price_update;

        publisher.total_submissions = publisher
            .total_submissions
            .checked_add(1)
            .ok_or(OracleError::InvalidConfig)?;
        publisher.last_submitted_day = day;

        Ok(())
    }

    /// Aggregate publisher submissions for a given day into IndexState.
    /// `remaining_accounts` carries the PriceUpdate accounts to consider (caller's responsibility
    /// to pass a comprehensive set; the program validates ownership + day of each).
    /// Spec: docs/oracle.md §5 on-chain aggregation, docs/methodology.md §7 index formula.
    pub fn aggregate_day(ctx: Context<AggregateDay>, day: u32) -> Result<()> {
        require!(!ctx.accounts.config.paused, OracleError::OraclePaused);
        let min_pubs = ctx.accounts.config.min_publishers_per_day as usize;

        // Collect submitted prices per constituent.
        let mut prices_per: Vec<Vec<u64>> = (0..25).map(|_| Vec::new()).collect();

        for acc in ctx.remaining_accounts.iter() {
            // Ownership check: only price updates from this program count.
            require!(acc.owner == &crate::ID, OracleError::Unauthorized);
            let data = acc.try_borrow_data()?;
            let mut slice: &[u8] = &data;
            let pu = PriceUpdate::try_deserialize(&mut slice)?;
            if pu.day != day {
                continue;
            }
            for (i, &price) in pu.prices.iter().enumerate() {
                prices_per[i].push(price);
            }
        }

        // Per-constituent median (or stale if too few submissions).
        let mut aggregated_prices = [0u64; 25];
        let mut constituent_status = [0u8; 25];
        for i in 0..25 {
            let mut ps = std::mem::take(&mut prices_per[i]);
            if ps.len() < min_pubs {
                constituent_status[i] = 1; // stale per methodology §6 fallback
                aggregated_prices[i] = 0;
                continue;
            }
            ps.sort_unstable();
            let mid = ps.len() / 2;
            aggregated_prices[i] = if ps.len() % 2 == 0 {
                (ps[mid - 1] + ps[mid]) / 2
            } else {
                ps[mid]
            };
        }

        // Chain-linking: a constituent with base_price = 0 hasn't been aggregated yet.
        // On first observation, set its base to the current price so it contributes 1.0
        // to the index (index-neutral entry per methodology §7).
        let mut registry = ctx.accounts.registry.load_mut()?;
        for i in 0..25 {
            if registry.constituents[i].base_price == 0 && aggregated_prices[i] > 0 {
                registry.constituents[i].base_price = aggregated_prices[i];
            }
        }

        // Index value: I = 1000 × (1/25) × Σ (P_t / P_base), scaled ×1e6 throughout.
        let mut sum_ratios: u128 = 0;
        for i in 0..25 {
            let p_t = aggregated_prices[i];
            let p_base = registry.constituents[i].base_price;
            let ratio_scaled: u128 = if p_t == 0 || p_base == 0 {
                // Stale or pre-aggregation constituent: contributes 1.0 (×1e6) to the mean.
                1_000_000
            } else {
                (p_t as u128)
                    .checked_mul(1_000_000)
                    .and_then(|x| x.checked_div(p_base as u128))
                    .ok_or(OracleError::InvalidConfig)?
            };
            sum_ratios = sum_ratios
                .checked_add(ratio_scaled)
                .ok_or(OracleError::InvalidConfig)?;
        }
        // 1000 × sum / 25 = 40 × sum
        let index_value = sum_ratios
            .checked_mul(40)
            .ok_or(OracleError::InvalidConfig)? as u64;

        // Write IndexState as provisional. Challenge window (oracle.md §6) precedes finalize_day.
        let index_state = &mut ctx.accounts.index_state;
        index_state.day = day;
        index_state.status = IndexStatus::Provisional;
        index_state.aggregated_prices = aggregated_prices;
        index_state.constituent_status = constituent_status;
        index_state.index_value = index_value;
        // Stamp the provisional timestamp here so finalize_day can compute the challenge window.
        index_state.finalized_at = Clock::get()?.unix_timestamp;
        index_state.bump = ctx.bumps.index_state;

        Ok(())
    }

    /// Finalize the index after the challenge window closes.
    /// Spec: docs/oracle.md §5 (provisional vs final).
    pub fn finalize_day(ctx: Context<FinalizeDay>, day: u32) -> Result<()> {
        require!(!ctx.accounts.config.paused, OracleError::OraclePaused);

        let challenge_window = ctx.accounts.config.challenge_window_seconds as i64;
        let clock = Clock::get()?;

        let index_state = &mut ctx.accounts.index_state;
        require!(index_state.day == day, OracleError::InvalidSubmissionDay);
        require!(
            index_state.status == IndexStatus::Provisional,
            OracleError::InvalidIndexStatus
        );

        // `finalized_at` was set by aggregate_day to mark when the provisional state was written.
        let provisional_at = index_state.finalized_at;
        let elapsed = clock.unix_timestamp - provisional_at;
        require!(elapsed >= challenge_window, OracleError::ChallengeWindowOpen);

        index_state.status = IndexStatus::Final;
        index_state.finalized_at = clock.unix_timestamp;
        Ok(())
    }

    /// Open a challenge against a publisher's submission for a specific (day, constituent).
    /// Escrows the challenger's USDC bond into a per-challenge vault PDA. Bond either
    /// returns to challenger (success) or gets redistributed 50/50 to the targeted
    /// publisher's bond vault + protocol treasury (failure).
    /// Spec: docs/oracle.md §6 dispute mechanism.
    pub fn open_challenge(
        ctx: Context<OpenChallenge>,
        target_day: u32,
        target_publisher: Pubkey,
        target_constituent: u8,
        claimed_correct_price: u64,
        evidence_uri: String,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, OracleError::OraclePaused);
        require!((target_constituent as usize) < 25, OracleError::InvalidConfig);
        require!(evidence_uri.len() <= 200, OracleError::InvalidConfig);

        // Challenge window check: state must be Provisional and within window.
        let index_state = &ctx.accounts.index_state;
        require!(
            index_state.day == target_day,
            OracleError::InvalidSubmissionDay
        );
        require!(
            index_state.status == IndexStatus::Provisional,
            OracleError::InvalidIndexStatus
        );

        let clock = Clock::get()?;
        let elapsed = clock.unix_timestamp - index_state.finalized_at;
        let window = ctx.accounts.config.challenge_window_seconds as i64;
        require!(
            elapsed >= 0 && elapsed < window,
            OracleError::ChallengeWindowClosed
        );

        let bond_amount = ctx.accounts.config.challenge_bond;
        require!(
            ctx.accounts.challenger_usdc_account.amount >= bond_amount,
            OracleError::InsufficientBond
        );

        // Escrow the challenger's bond into the per-challenge vault PDA.
        let cpi_accounts = Transfer {
            from: ctx.accounts.challenger_usdc_account.to_account_info(),
            to: ctx.accounts.challenge_bond_vault.to_account_info(),
            authority: ctx.accounts.challenger.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            bond_amount,
        )?;

        let challenge = &mut ctx.accounts.challenge;
        challenge.challenger = ctx.accounts.challenger.key();
        challenge.target_publisher = target_publisher;
        challenge.target_day = target_day;
        challenge.target_constituent = target_constituent;
        challenge.claimed_correct_price = claimed_correct_price;
        challenge.evidence_uri = evidence_uri;
        challenge.bond = bond_amount;
        challenge.status = ChallengeStatus::Open;
        challenge.opened_at = clock.unix_timestamp;
        challenge.resolved_at = 0;
        challenge.slash_bps = 0;
        challenge.slashed_amount = 0;
        challenge.challenger_payout = 0;
        challenge.bump = ctx.bumps.challenge;
        Ok(())
    }

    /// Resolve an open challenge (admin-resolved in v0.5; committee multisig is v0.6+).
    ///
    /// `slash_bps` is only meaningful when `challenge_succeeded == true`. Spec §7 tiers:
    ///   - 1000 (10%)  → price off by >5% from corrected median, 1-month suspension
    ///   - 5000 (50%)  → price off by >15%, 6-month suspension
    ///   - 10000 (100%) → demonstrable collusion, permanent removal
    /// On failure pass any value (ignored).
    ///
    /// **Success cash flow**:
    ///   slashed_amount = publisher.bond_amount × slash_bps / 10_000
    ///   - slashed_amount/2 → challenger USDC ATA
    ///   - remainder       → protocol treasury vault
    ///   - challenger bond refunded in full
    ///   - publisher.bond_amount decreases; status → Suspended (≥5000) or Removed (10000)
    ///
    /// **Failure cash flow**: challenger bond split 50/50 → publisher bond vault (refill,
    /// increments publisher.bond_amount) and protocol treasury vault.
    ///
    /// **v0.5 scope cut**: spec §7's "25% to remaining publishers" distribution on success
    /// is rolled into the 50% treasury share (no N-publisher fan-out yet). Liveness slashing
    /// is a separate mechanism, also deferred.
    ///
    /// Spec: docs/oracle.md §6 resolution + §7 slashing schedule + flow.
    pub fn resolve_challenge(
        ctx: Context<ResolveChallenge>,
        challenge_succeeded: bool,
        slash_bps: u16,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, OracleError::OraclePaused);
        require!(
            ctx.accounts.config.protocol_treasury_vault != Pubkey::default(),
            OracleError::TreasuryNotConfigured
        );
        require!(
            ctx.accounts.treasury_vault.key() == ctx.accounts.config.protocol_treasury_vault,
            OracleError::TreasuryVaultMismatch
        );

        // Cross-check: passed Publisher matches Challenge.target_publisher.
        require!(
            ctx.accounts.target_publisher_account.publisher_key
                == ctx.accounts.challenge.target_publisher,
            OracleError::ChallengeTargetMismatch
        );
        // And the Publisher's recorded bond vault matches the passed bond vault.
        require!(
            ctx.accounts.target_publisher_account.bond_vault
                == ctx.accounts.target_publisher_bond_vault.key(),
            OracleError::PublisherBondVaultMismatch
        );

        let challenge_key = ctx.accounts.challenge.key();
        require!(
            ctx.accounts.challenge.status == ChallengeStatus::Open,
            OracleError::InvalidIndexStatus
        );

        // Reborrow challenge for fields we read in seed construction below.
        let challenger_key = ctx.accounts.challenge.challenger;
        let target_day = ctx.accounts.challenge.target_day;
        let target_constituent = ctx.accounts.challenge.target_constituent;
        let bond_amount = ctx.accounts.challenge.bond;

        // Seeds for signing as the challenge bond vault PDA.
        let day_bytes = target_day.to_le_bytes();
        let constituent_byte = [target_constituent];
        let cbv_bump = ctx.bumps.challenge_bond_vault;
        let cbv_seeds: &[&[u8]] = &[
            CHALLENGE_BOND_VAULT_SEED,
            challenger_key.as_ref(),
            &day_bytes,
            &constituent_byte,
            std::slice::from_ref(&cbv_bump),
        ];
        let cbv_signer = &[cbv_seeds];

        // Seeds for signing as the targeted publisher bond vault PDA.
        let publisher_key = ctx.accounts.target_publisher_account.publisher_key;
        let publisher_bond_vault_bump = ctx.bumps.target_publisher_bond_vault;
        let pbv_seeds: &[&[u8]] = &[
            BOND_VAULT_SEED,
            publisher_key.as_ref(),
            std::slice::from_ref(&publisher_bond_vault_bump),
        ];
        let pbv_signer = &[pbv_seeds];

        let mut slashed_amount: u64 = 0;
        let mut challenger_payout: u64 = 0;
        let mut effective_slash_bps: u16 = 0;

        if challenge_succeeded {
            require!(
                slash_bps == 1_000 || slash_bps == 5_000 || slash_bps == 10_000,
                OracleError::InvalidSlashSeverity
            );

            // Compute slash amount against the publisher's *current* effective bond.
            let publisher_bond = ctx.accounts.target_publisher_account.bond_amount;
            slashed_amount = (publisher_bond as u128)
                .checked_mul(slash_bps as u128)
                .and_then(|x| x.checked_div(10_000))
                .ok_or(OracleError::InvalidConfig)? as u64;

            if slashed_amount > 0 {
                // Slashed funds: 50% to challenger, remainder to protocol treasury.
                let challenger_share = slashed_amount / 2;
                let treasury_share = slashed_amount - challenger_share;

                if challenger_share > 0 {
                    let cpi = Transfer {
                        from: ctx.accounts.target_publisher_bond_vault.to_account_info(),
                        to: ctx.accounts.challenger_usdc_account.to_account_info(),
                        authority: ctx.accounts.target_publisher_bond_vault.to_account_info(),
                    };
                    token::transfer(
                        CpiContext::new_with_signer(
                            ctx.accounts.token_program.to_account_info(),
                            cpi,
                            pbv_signer,
                        ),
                        challenger_share,
                    )?;
                }
                if treasury_share > 0 {
                    let cpi = Transfer {
                        from: ctx.accounts.target_publisher_bond_vault.to_account_info(),
                        to: ctx.accounts.treasury_vault.to_account_info(),
                        authority: ctx.accounts.target_publisher_bond_vault.to_account_info(),
                    };
                    token::transfer(
                        CpiContext::new_with_signer(
                            ctx.accounts.token_program.to_account_info(),
                            cpi,
                            pbv_signer,
                        ),
                        treasury_share,
                    )?;
                }

                // Decrement publisher's effective bond.
                let pub_acct = &mut ctx.accounts.target_publisher_account;
                pub_acct.bond_amount = pub_acct
                    .bond_amount
                    .checked_sub(slashed_amount)
                    .ok_or(OracleError::InvalidConfig)?;
                pub_acct.successful_challenges_against = pub_acct
                    .successful_challenges_against
                    .checked_add(1)
                    .ok_or(OracleError::InvalidConfig)?;

                // Status transition per §7 schedule.
                if slash_bps == 10_000 {
                    pub_acct.status = PublisherStatus::Removed;
                } else if slash_bps >= 5_000 {
                    pub_acct.status = PublisherStatus::Suspended;
                }
                // 10% slash: leave status alone (warning level — caller can suspend separately).

                challenger_payout = challenger_payout
                    .checked_add(challenger_share)
                    .ok_or(OracleError::InvalidConfig)?;
            }

            // Refund challenger's bond in full.
            if bond_amount > 0 {
                let cpi = Transfer {
                    from: ctx.accounts.challenge_bond_vault.to_account_info(),
                    to: ctx.accounts.challenger_usdc_account.to_account_info(),
                    authority: ctx.accounts.challenge_bond_vault.to_account_info(),
                };
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        cpi,
                        cbv_signer,
                    ),
                    bond_amount,
                )?;
                challenger_payout = challenger_payout
                    .checked_add(bond_amount)
                    .ok_or(OracleError::InvalidConfig)?;
            }

            effective_slash_bps = slash_bps;
        } else {
            // Failed challenge: redistribute challenger bond 50/50 to publisher + treasury.
            if bond_amount > 0 {
                let publisher_share = bond_amount / 2;
                let treasury_share = bond_amount - publisher_share;

                if publisher_share > 0 {
                    let cpi = Transfer {
                        from: ctx.accounts.challenge_bond_vault.to_account_info(),
                        to: ctx.accounts.target_publisher_bond_vault.to_account_info(),
                        authority: ctx.accounts.challenge_bond_vault.to_account_info(),
                    };
                    token::transfer(
                        CpiContext::new_with_signer(
                            ctx.accounts.token_program.to_account_info(),
                            cpi,
                            cbv_signer,
                        ),
                        publisher_share,
                    )?;
                    // Refilled stake counts toward effective bond for future slash math.
                    let pub_acct = &mut ctx.accounts.target_publisher_account;
                    pub_acct.bond_amount = pub_acct
                        .bond_amount
                        .checked_add(publisher_share)
                        .ok_or(OracleError::InvalidConfig)?;
                }
                if treasury_share > 0 {
                    let cpi = Transfer {
                        from: ctx.accounts.challenge_bond_vault.to_account_info(),
                        to: ctx.accounts.treasury_vault.to_account_info(),
                        authority: ctx.accounts.challenge_bond_vault.to_account_info(),
                    };
                    token::transfer(
                        CpiContext::new_with_signer(
                            ctx.accounts.token_program.to_account_info(),
                            cpi,
                            cbv_signer,
                        ),
                        treasury_share,
                    )?;
                }
            }
        }

        let _ = challenge_key; // silence unused (reserved for emit_!)

        let challenge = &mut ctx.accounts.challenge;
        challenge.resolved_at = Clock::get()?.unix_timestamp;
        challenge.status = if challenge_succeeded {
            ChallengeStatus::Succeeded
        } else {
            ChallengeStatus::Failed
        };
        challenge.slash_bps = effective_slash_bps;
        challenge.slashed_amount = slashed_amount;
        challenge.challenger_payout = challenger_payout;

        Ok(())
    }

    /// Emergency pause the oracle (admin only).
    /// Spec: docs/oracle.md §9 failure modes.
    pub fn emergency_pause(ctx: Context<EmergencyPause>, reason: u8) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.paused = true;
        config.pause_reason = reason;
        Ok(())
    }

    /// Lift the emergency pause (admin only).
    pub fn emergency_unpause(ctx: Context<EmergencyPause>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.paused = false;
        config.pause_reason = 0;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeParams {
    pub publisher_bond: u64,
    pub challenge_bond: u64,
    pub min_publishers_per_day: u8,
    pub submission_window_start: u32,
    pub submission_window_end: u32,
    pub challenge_window_seconds: u32,
}

// ---------- Accounts contexts (stubbed; expand when implementing) ----------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(publisher_key: Pubkey)]
pub struct RegisterPublisher<'info> {
    // Heavy accounts are Box'd to keep `try_accounts` stack frame under Solana's 4KB cap.
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ OracleError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Publisher::INIT_SPACE,
        seeds = [PUBLISHER_SEED, publisher_key.as_ref()],
        bump,
    )]
    pub publisher_account: Box<Account<'info, Publisher>>,

    /// Admin's USDC ATA, source of the bond.
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = admin,
    )]
    pub admin_usdc_account: Box<Account<'info, TokenAccount>>,

    /// Per-publisher bond vault, owned by the program PDA.
    #[account(
        init,
        payer = admin,
        seeds = [BOND_VAULT_SEED, publisher_key.as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = bond_vault,
    )]
    pub bond_vault: Box<Account<'info, TokenAccount>>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Returns the current Unix day number (days since epoch).
/// Used for publisher.joined_day, daily submissions, etc.
fn current_unix_day() -> Result<u32> {
    let clock = Clock::get()?;
    Ok((clock.unix_timestamp / 86400) as u32)
}

#[derive(Accounts)]
pub struct ActivatePublisher<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ OracleError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,

    pub admin: Signer<'info>,

    #[account(mut)]
    pub publisher_account: Box<Account<'info, Publisher>>,
}

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ OracleError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// Zero-copy account; `init` zero-fills the data segment.
    #[account(
        init,
        payer = admin,
        space = 8 + std::mem::size_of::<ConstituentRegistry>(),
        seeds = [CONSTITUENT_REGISTRY_SEED],
        bump,
    )]
    pub registry: AccountLoader<'info, ConstituentRegistry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConstituent<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ OracleError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,

    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONSTITUENT_REGISTRY_SEED],
        bump,
    )]
    pub registry: AccountLoader<'info, ConstituentRegistry>,
}

#[derive(Accounts)]
pub struct FinalizeRegistryUpdate<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ OracleError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,

    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONSTITUENT_REGISTRY_SEED],
        bump,
    )]
    pub registry: AccountLoader<'info, ConstituentRegistry>,
}

#[derive(Accounts)]
#[instruction(day: u32)]
pub struct SubmitPriceUpdate<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    /// Signing publisher pubkey. Must match `publisher_account.publisher_key`.
    #[account(mut)]
    pub publisher: Signer<'info>,

    /// Publisher record. PDA is bound to `publisher.key()`, so the signer must match.
    #[account(
        mut,
        seeds = [PUBLISHER_SEED, publisher.key().as_ref()],
        bump = publisher_account.bump,
    )]
    pub publisher_account: Account<'info, Publisher>,

    /// New PriceUpdate account, one per (publisher, day).
    #[account(
        init,
        payer = publisher,
        space = 8 + PriceUpdate::INIT_SPACE,
        seeds = [PRICE_UPDATE_SEED, publisher.key().as_ref(), &day.to_le_bytes()],
        bump,
    )]
    pub price_update: Account<'info, PriceUpdate>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(day: u32)]
pub struct AggregateDay<'info> {
    // ConstituentRegistry and IndexState are heavy (25-element arrays); must be boxed.
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    /// Mutated for chain-linking new constituents on first observation.
    /// Zero-copy access via `.load_mut()` in the handler.
    #[account(
        mut,
        seeds = [CONSTITUENT_REGISTRY_SEED],
        bump,
    )]
    pub registry: AccountLoader<'info, ConstituentRegistry>,

    /// Singleton IndexState — created on first aggregation, updated on subsequent days.
    #[account(
        init_if_needed,
        payer = caller,
        space = 8 + IndexState::INIT_SPACE,
        seeds = [INDEX_STATE_SEED],
        bump,
    )]
    pub index_state: Box<Account<'info, IndexState>>,

    /// Anyone can call; the caller pays rent for the IndexState on first day.
    #[account(mut)]
    pub caller: Signer<'info>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: variable number of PriceUpdate accounts.
}

#[derive(Accounts)]
pub struct FinalizeDay<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    /// Anyone can finalize once the challenge window has elapsed.
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [INDEX_STATE_SEED],
        bump = index_state.bump,
    )]
    pub index_state: Box<Account<'info, IndexState>>,
}

#[derive(Accounts)]
#[instruction(target_day: u32, target_publisher: Pubkey, target_constituent: u8)]
pub struct OpenChallenge<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    #[account(mut)]
    pub challenger: Signer<'info>,

    #[account(seeds = [INDEX_STATE_SEED], bump = index_state.bump)]
    pub index_state: Box<Account<'info, IndexState>>,

    #[account(
        init,
        payer = challenger,
        space = 8 + Challenge::INIT_SPACE,
        seeds = [
            CHALLENGE_SEED,
            challenger.key().as_ref(),
            &target_day.to_le_bytes(),
            &[target_constituent],
        ],
        bump,
    )]
    pub challenge: Box<Account<'info, Challenge>>,

    /// Challenger's USDC source for the bond.
    #[account(
        mut,
        token::mint = usdc_mint,
        token::authority = challenger,
    )]
    pub challenger_usdc_account: Box<Account<'info, TokenAccount>>,

    /// Per-challenge bond escrow PDA — created here, owned by itself.
    #[account(
        init,
        payer = challenger,
        seeds = [
            CHALLENGE_BOND_VAULT_SEED,
            challenger.key().as_ref(),
            &target_day.to_le_bytes(),
            &[target_constituent],
        ],
        bump,
        token::mint = usdc_mint,
        token::authority = challenge_bond_vault,
    )]
    pub challenge_bond_vault: Box<Account<'info, TokenAccount>>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetProtocolTreasury<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ OracleError::Unauthorized,
    )]
    pub config: Account<'info, Config>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveChallenge<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ OracleError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,

    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [
            CHALLENGE_SEED,
            challenge.challenger.as_ref(),
            &challenge.target_day.to_le_bytes(),
            &[challenge.target_constituent],
        ],
        bump = challenge.bump,
    )]
    pub challenge: Box<Account<'info, Challenge>>,

    /// Per-challenge bond escrow holding the challenger's stake.
    #[account(
        mut,
        seeds = [
            CHALLENGE_BOND_VAULT_SEED,
            challenge.challenger.as_ref(),
            &challenge.target_day.to_le_bytes(),
            &[challenge.target_constituent],
        ],
        bump,
    )]
    pub challenge_bond_vault: Box<Account<'info, TokenAccount>>,

    /// The targeted publisher's record — needed to read bond_amount, update on slash.
    #[account(
        mut,
        seeds = [PUBLISHER_SEED, target_publisher_account.publisher_key.as_ref()],
        bump = target_publisher_account.bump,
    )]
    pub target_publisher_account: Box<Account<'info, Publisher>>,

    /// Publisher's bond vault — funds slashed FROM here (success) or refilled INTO it (failure).
    #[account(
        mut,
        seeds = [BOND_VAULT_SEED, target_publisher_account.publisher_key.as_ref()],
        bump,
    )]
    pub target_publisher_bond_vault: Box<Account<'info, TokenAccount>>,

    /// Challenger's USDC ATA — receives slashed share + bond refund on success.
    /// On failure this account is touched only for handler symmetry; no transfer happens.
    #[account(mut)]
    pub challenger_usdc_account: Box<Account<'info, TokenAccount>>,

    /// Protocol treasury USDC vault — validated against `config.protocol_treasury_vault`
    /// in the handler. Note this is a perp-engine PDA; oracle has no authority over it.
    #[account(mut)]
    pub treasury_vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct EmergencyPause<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ OracleError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,

    pub admin: Signer<'info>,
}
