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
        config.pending_admin = Pubkey::default(); // v0.8: no transfer in flight
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
        publisher.last_liveness_slash_tier = 0; // v0.9: no liveness slash pending at registration
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
        require!((idx as usize) < CONSTITUENT_COUNT, OracleError::InvalidConfig);

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
        prices: [u64; CONSTITUENT_COUNT],
        sale_counts: [u16; CONSTITUENT_COUNT],
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
        // v0.9: a successful submission ends any in-flight liveness-slash gap,
        // so reset the tier-applied marker.  The next absence starts fresh.
        publisher.last_liveness_slash_tier = 0;

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
        let mut prices_per: Vec<Vec<u64>> = (0..CONSTITUENT_COUNT).map(|_| Vec::new()).collect();

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
        let mut aggregated_prices = [0u64; CONSTITUENT_COUNT];
        let mut constituent_status = [0u8; CONSTITUENT_COUNT];
        for i in 0..CONSTITUENT_COUNT {
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
        for i in 0..CONSTITUENT_COUNT {
            if registry.constituents[i].base_price == 0 && aggregated_prices[i] > 0 {
                registry.constituents[i].base_price = aggregated_prices[i];
            }
        }

        // Index value: I = 1000 × (1/CONSTITUENT_COUNT) × Σ (P_t / P_base), scaled ×1e6 throughout.
        let mut sum_ratios: u128 = 0;
        for i in 0..CONSTITUENT_COUNT {
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
        // index = 1000 × sum / CONSTITUENT_COUNT. 1000 mod N == 0 for the supported sizes
        // (25 → ×40, 50 → ×20), so this is exact integer division; we keep it as a
        // div instead of a precomputed factor so the formula stays correct if N changes.
        let index_value = sum_ratios
            .checked_mul(1000)
            .and_then(|x| x.checked_div(CONSTITUENT_COUNT as u128))
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
        require!((target_constituent as usize) < CONSTITUENT_COUNT, OracleError::InvalidConfig);
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

    /// Resolve an open challenge — **permissionless and fully on-chain (v0.9)**.
    ///
    /// Replaces the v0.5–v0.8 admin-attested path: instead of the admin passing
    /// `challenge_succeeded` + `slash_bps`, this ix reads the publisher's actual
    /// submitted price for the challenged constituent and the protocol's
    /// aggregated price on that day, computes the deviation arithmetically, and
    /// maps to a slash tier per oracle.md §7:
    ///
    ///   deviation < 2%       → challenge FAILS (within market noise)
    ///   deviation 2% – <5%   → 10% slash (warning level)
    ///   deviation 5% – <10%  → 50% slash + status → Suspended
    ///   deviation ≥ 10%      → 100% slash + status → Removed
    ///
    /// Deviation is `|publisher_price − aggregated_price| / aggregated_price`,
    /// scaled to basis points.  The aggregated price is the median across all
    /// submitting publishers for that day, finalized into `IndexState`.  A
    /// publisher whose submission lands close to the median can't be slashed
    /// regardless of who challenges them; one that lands far from the median
    /// gets slashed proportionally with no admin discretion.
    ///
    /// Cash flows are unchanged from v0.5:
    ///   - Success: slashed_amount = publisher.bond × slash_bps / 10_000.
    ///     50% → challenger USDC ATA, 50% → protocol treasury vault. Challenger
    ///     bond refunded in full.
    ///   - Failure: challenger bond split 50/50 → publisher bond vault (refill)
    ///     + protocol treasury vault.
    ///
    /// Spec: docs/oracle.md §6 resolution + §7 slashing schedule + flow.
    pub fn resolve_challenge(ctx: Context<ResolveChallenge>) -> Result<()> {
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

        // ----- v0.9 on-chain deviation computation -----
        // Read the publisher's submitted price for the challenged constituent
        // and the aggregated (median) price from IndexState.  Compute the
        // absolute deviation in bps and map to a slash tier — no admin
        // discretion involved.
        let constituent_idx = target_constituent as usize;
        require!((constituent_idx as usize) < CONSTITUENT_COUNT, OracleError::InvalidConfig);

        let aggregated_price =
            ctx.accounts.index_state.aggregated_prices[constituent_idx];

        // If the aggregated price is zero, the constituent went stale that day
        // (insufficient publishers per Config.min_publishers_per_day, see
        // aggregate_day's all-stale path).  There's no consensus to measure
        // deviation against — dismiss the challenge.  This is also the right
        // behavior in production: a publisher whose submission landed on a
        // low-consensus day shouldn't be slashable via challenge for it.
        let (challenge_succeeded, slash_bps) = if aggregated_price == 0 {
            (false, 0u16)
        } else {
            let publisher_price =
                ctx.accounts.target_price_update.prices[constituent_idx];
            let diff = if publisher_price > aggregated_price {
                publisher_price - aggregated_price
            } else {
                aggregated_price - publisher_price
            };
            // bps = diff * 10_000 / aggregated_price.  u128 to avoid overflow
            // on large prices; the result fits in u32 even at 10000+ bps.
            let deviation_bps = (diff as u128)
                .checked_mul(10_000)
                .and_then(|x| x.checked_div(aggregated_price as u128))
                .ok_or(OracleError::InvalidConfig)? as u32;
            deviation_to_slash_tier(deviation_bps)
        };

        let mut slashed_amount: u64 = 0;
        let mut challenger_payout: u64 = 0;
        let mut effective_slash_bps: u16 = 0;

        if challenge_succeeded {

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

    /// Liveness slashing — anyone can crank this against a publisher whose
    /// last submission is sufficiently far in the past (v0.9).  Tiered per
    /// oracle.md §7:
    ///
    ///   days absent ≥ 3  → tier 1 :  5% of current bond slashed
    ///   days absent ≥ 7  → tier 2 : 25% of current bond slashed + Suspended
    ///   days absent ≥ 14 → tier 3 :100% of current bond slashed + Removed
    ///
    /// `last_liveness_slash_tier` on Publisher tracks the highest tier already
    /// applied to the *current* absence gap; this ix requires the target tier
    /// to be strictly higher than that, which prevents repeatedly slashing
    /// inside a tier (calling on day 4 and again on day 5 = no double tier-1).
    /// The counter resets to 0 on the publisher's next successful submission,
    /// so a publisher who returns after a 5% slash can be tier-1-slashed
    /// again on a fresh gap weeks later.
    ///
    /// Only Active or Suspended publishers are eligible.  Shadow publishers
    /// haven't activated yet (and have shadow_period_days_remaining instead);
    /// Removed publishers have nothing left to slash.  Slashed funds route
    /// 100% to the protocol treasury (no challenger to split with).
    pub fn slash_for_liveness(ctx: Context<SlashForLiveness>) -> Result<()> {
        require!(!ctx.accounts.config.paused, OracleError::OraclePaused);
        require!(
            ctx.accounts.config.protocol_treasury_vault != Pubkey::default(),
            OracleError::TreasuryNotConfigured
        );
        require!(
            ctx.accounts.treasury_vault.key()
                == ctx.accounts.config.protocol_treasury_vault,
            OracleError::TreasuryVaultMismatch
        );
        require!(
            ctx.accounts.publisher_account.bond_vault
                == ctx.accounts.publisher_bond_vault.key(),
            OracleError::PublisherBondVaultMismatch
        );

        let publisher = &ctx.accounts.publisher_account;
        require!(
            publisher.status == PublisherStatus::Active
                || publisher.status == PublisherStatus::Suspended,
            OracleError::PublisherNotEligibleForLivenessSlash
        );

        let current_day = current_unix_day()?;
        let days_absent = current_day.saturating_sub(publisher.last_submitted_day);

        // Tier thresholds + slash bps come from pure helpers so they're unit-testable.
        let target_tier = days_absent_to_tier(days_absent);
        require!(
            target_tier > publisher.last_liveness_slash_tier,
            OracleError::NoNewLivenessSlashTier
        );
        let slash_bps = liveness_tier_to_slash_bps(target_tier);

        let current_bond = publisher.bond_amount;
        let slash_amount = ((current_bond as u128) * (slash_bps as u128) / 10_000) as u64;

        if slash_amount > 0 {
            let pub_key = publisher.publisher_key;
            let bond_bump = ctx.bumps.publisher_bond_vault;
            let seeds: &[&[u8]] = &[
                BOND_VAULT_SEED,
                pub_key.as_ref(),
                std::slice::from_ref(&bond_bump),
            ];
            let signer = &[seeds];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.publisher_bond_vault.to_account_info(),
                        to: ctx.accounts.treasury_vault.to_account_info(),
                        authority: ctx.accounts.publisher_bond_vault.to_account_info(),
                    },
                    signer,
                ),
                slash_amount,
            )?;
        }

        // Apply state changes after the CPI succeeds.
        let pub_acct = &mut ctx.accounts.publisher_account;
        pub_acct.bond_amount = pub_acct
            .bond_amount
            .checked_sub(slash_amount)
            .ok_or(OracleError::InvalidConfig)?;
        pub_acct.last_liveness_slash_tier = target_tier;
        match target_tier {
            2 => pub_acct.status = PublisherStatus::Suspended,
            3 => pub_acct.status = PublisherStatus::Removed,
            _ => {} // tier 1: warning only, status unchanged
        }

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

    // ============================================================
    // Two-step admin transfer (v0.8) — mirrors perp-engine's pattern.
    // See programs/perp-engine/src/lib.rs for full design notes.  Both programs
    // need this so the same Squads multisig can be wired in across the whole
    // protocol via two on-chain calls (one per program).
    // ============================================================

    /// Current admin nominates a new admin. Overwrites any prior proposal.
    pub fn propose_admin_transfer(
        ctx: Context<ProposeAdminTransfer>,
        new_admin: Pubkey,
    ) -> Result<()> {
        ctx.accounts.config.pending_admin = new_admin;
        Ok(())
    }

    /// Proposed admin signs to accept authority; commit + clear pending slot.
    pub fn accept_admin_transfer(ctx: Context<AcceptAdminTransfer>) -> Result<()> {
        require!(
            ctx.accounts.config.pending_admin != Pubkey::default(),
            OracleError::Unauthorized
        );
        let config = &mut ctx.accounts.config;
        config.admin = config.pending_admin;
        config.pending_admin = Pubkey::default();
        Ok(())
    }

    /// v0.10 migration: realloc ConstituentRegistry + IndexState from the old
    /// N=25 layout to the current N=50 layout. One-shot admin call to migrate
    /// existing accounts on devnet/mainnet after `anchor upgrade`. The realloc
    /// constraints on the accounts struct do the resize; slots 25..49 of the
    /// registry and the new tail bytes of IndexState start zero-initialised.
    /// Populate the new constituent slots via the existing chunked rebalance
    /// flow (initialize_registry_update + update_constituent × N + finalize).
    /// No-op for fresh deployments (initialize_registry already sizes for 50).
    ///
    /// We realloc both accounts manually (UncheckedAccount) because the existing
    /// N=25 bytes can't be loaded into the N=50 structs by Anchor's normal
    /// AccountLoader / Account deserializers before the resize takes effect.
    pub fn expand_constituents_to_50(
        ctx: Context<ExpandConstituentsTo50>,
    ) -> Result<()> {
        let admin_ai = ctx.accounts.admin.to_account_info();
        let sys_ai = ctx.accounts.system_program.to_account_info();
        let rent = Rent::get()?;

        // ----- registry: grow to 8 + size_of::<ConstituentRegistry>() -----
        let reg_target = 8 + std::mem::size_of::<ConstituentRegistry>();
        let reg_ai = ctx.accounts.registry.to_account_info();
        let reg_cur = reg_ai.data_len();
        msg!("registry cur={} target={}", reg_cur, reg_target);
        if reg_cur < reg_target {
            let reg_min = rent.minimum_balance(reg_target);
            if reg_min > reg_ai.lamports() {
                let topup = reg_min - reg_ai.lamports();
                msg!("registry topup={}", topup);
                anchor_lang::system_program::transfer(
                    CpiContext::new(
                        sys_ai.clone(),
                        anchor_lang::system_program::Transfer {
                            from: admin_ai.clone(),
                            to: reg_ai.clone(),
                        },
                    ),
                    topup,
                )?;
            }
            reg_ai.realloc(reg_target, true)?;
            msg!("registry realloc'd to {}", reg_ai.data_len());
        }

        // ----- index_state: grow to 8 + IndexState::INIT_SPACE -----
        let idx_target = 8 + IndexState::INIT_SPACE;
        let idx_ai = ctx.accounts.index_state.to_account_info();
        let idx_cur = idx_ai.data_len();
        msg!("index_state cur={} target={}", idx_cur, idx_target);
        if idx_cur < idx_target {
            let idx_min = rent.minimum_balance(idx_target);
            if idx_min > idx_ai.lamports() {
                let topup = idx_min - idx_ai.lamports();
                msg!("index_state topup={}", topup);
                anchor_lang::system_program::transfer(
                    CpiContext::new(
                        sys_ai.clone(),
                        anchor_lang::system_program::Transfer {
                            from: admin_ai.clone(),
                            to: idx_ai.clone(),
                        },
                    ),
                    topup,
                )?;
            }
            idx_ai.realloc(idx_target, true)?;
            msg!("index_state realloc'd to {}", idx_ai.data_len());
        }
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ExpandConstituentsTo50<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ OracleError::Unauthorized,
    )]
    pub config: Account<'info, Config>,

    /// Manually realloc'd inside the handler (existing N=25 bytes can't be
    /// loaded into the N=50 ConstituentRegistry struct by AccountLoader).
    /// CHECK: PDA verified by seeds; admin-gated via Config.admin == admin.
    #[account(
        mut,
        seeds = [CONSTITUENT_REGISTRY_SEED],
        bump,
    )]
    pub registry: UncheckedAccount<'info>,

    /// Manually realloc'd inside the handler (existing N=25 bytes can't be
    /// borsh-deserialized into the N=50 IndexState struct).
    /// CHECK: PDA verified by seeds; admin-gated via Config.admin == admin.
    #[account(
        mut,
        seeds = [INDEX_STATE_SEED],
        bump,
    )]
    pub index_state: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
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

/// v0.9 challenge-resolution helper: deviation (in bps) → (challenge_succeeded,
/// slash_bps).  Pure function so it can be unit-tested without on-chain setup.
/// Thresholds per oracle.md §7:
///   <200 bps  (2%)  : within market noise → challenge dismissed
///   <500 bps  (5%)  : 10% slash tier (warning)
///   <1000 bps (10%) : 50% slash tier (Suspended)
///   ≥1000 bps       : 100% slash tier (Removed)
pub fn deviation_to_slash_tier(deviation_bps: u32) -> (bool, u16) {
    if deviation_bps < 200 {
        (false, 0)
    } else if deviation_bps < 500 {
        (true, 1_000)
    } else if deviation_bps < 1_000 {
        (true, 5_000)
    } else {
        (true, 10_000)
    }
}

/// v0.9 liveness-slashing helper: days_absent → tier (0/1/2/3).  Pure function
/// so it's unit-testable.  Thresholds per oracle.md §7:
///   <3 days  : no tier (caller should reject with NoNewLivenessSlashTier)
///   3–6 days : tier 1 (5% slash)
///   7–13 days: tier 2 (25% slash + Suspended)
///   ≥14 days : tier 3 (100% slash + Removed)
pub fn days_absent_to_tier(days_absent: u32) -> u8 {
    if days_absent >= 14 {
        3
    } else if days_absent >= 7 {
        2
    } else if days_absent >= 3 {
        1
    } else {
        0
    }
}

/// v0.9 liveness-slashing helper: tier → slash_bps (basis points of current bond).
pub fn liveness_tier_to_slash_bps(tier: u8) -> u16 {
    match tier {
        1 => 500,
        2 => 2_500,
        3 => 10_000,
        _ => 0,
    }
}

#[cfg(test)]
mod v09_tests {
    use super::*;

    #[test]
    fn deviation_below_2pct_dismisses() {
        assert_eq!(deviation_to_slash_tier(0), (false, 0));
        assert_eq!(deviation_to_slash_tier(50), (false, 0));
        assert_eq!(deviation_to_slash_tier(199), (false, 0));
    }

    #[test]
    fn deviation_2_to_5_pct_is_tier_1() {
        assert_eq!(deviation_to_slash_tier(200), (true, 1_000));
        assert_eq!(deviation_to_slash_tier(300), (true, 1_000));
        assert_eq!(deviation_to_slash_tier(499), (true, 1_000));
    }

    #[test]
    fn deviation_5_to_10_pct_is_tier_2() {
        assert_eq!(deviation_to_slash_tier(500), (true, 5_000));
        assert_eq!(deviation_to_slash_tier(750), (true, 5_000));
        assert_eq!(deviation_to_slash_tier(999), (true, 5_000));
    }

    #[test]
    fn deviation_at_or_above_10pct_is_tier_3() {
        assert_eq!(deviation_to_slash_tier(1_000), (true, 10_000));
        assert_eq!(deviation_to_slash_tier(5_000), (true, 10_000));
        assert_eq!(deviation_to_slash_tier(10_000), (true, 10_000));
        // Even far-out values cap at the tier 3 outcome (100% slash) — the
        // numeric value of slash_bps doesn't exceed 10_000.
        assert_eq!(deviation_to_slash_tier(50_000), (true, 10_000));
    }

    #[test]
    fn liveness_tiers_match_day_thresholds() {
        assert_eq!(days_absent_to_tier(0), 0);
        assert_eq!(days_absent_to_tier(2), 0);
        assert_eq!(days_absent_to_tier(3), 1);
        assert_eq!(days_absent_to_tier(6), 1);
        assert_eq!(days_absent_to_tier(7), 2);
        assert_eq!(days_absent_to_tier(13), 2);
        assert_eq!(days_absent_to_tier(14), 3);
        assert_eq!(days_absent_to_tier(365), 3);
    }

    #[test]
    fn liveness_slash_bps_per_tier() {
        assert_eq!(liveness_tier_to_slash_bps(0), 0);
        assert_eq!(liveness_tier_to_slash_bps(1), 500);
        assert_eq!(liveness_tier_to_slash_bps(2), 2_500);
        assert_eq!(liveness_tier_to_slash_bps(3), 10_000);
    }
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
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    /// v0.9: permissionless — anyone can crank a challenge resolution because
    /// the slash decision is computed arithmetically from on-chain state.
    /// The caller still pays the tx fee; in practice the challenger themselves
    /// has the strongest incentive to call this (they get their bond back +
    /// reward on success).
    pub caller: Signer<'info>,

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

    /// IndexState for the challenged day — the aggregated (median) price the
    /// deviation is measured against.  Pinned to challenge.target_day so
    /// callers can't substitute a different day's index to game the math.
    #[account(
        seeds = [INDEX_STATE_SEED],
        bump = index_state.bump,
        constraint = index_state.day == challenge.target_day @ OracleError::ChallengeIndexStateMismatch,
    )]
    pub index_state: Box<Account<'info, IndexState>>,

    /// The challenged publisher's actual PriceUpdate for the challenged day —
    /// the submission whose deviation is being judged.  PDA is per-
    /// (publisher, day), so the seed constraint already pins it to the right
    /// (publisher, day) pair; the explicit `constraint =` is belt-and-braces.
    #[account(
        seeds = [
            PRICE_UPDATE_SEED,
            challenge.target_publisher.as_ref(),
            &challenge.target_day.to_le_bytes(),
        ],
        bump = target_price_update.bump,
        constraint = target_price_update.publisher == challenge.target_publisher
            && target_price_update.day == challenge.target_day
            @ OracleError::ChallengePriceUpdateMismatch,
    )]
    pub target_price_update: Box<Account<'info, PriceUpdate>>,

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

/// Permissionless liveness-slashing crank (v0.9).
#[derive(Accounts)]
pub struct SlashForLiveness<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,

    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [PUBLISHER_SEED, publisher_account.publisher_key.as_ref()],
        bump = publisher_account.bump,
    )]
    pub publisher_account: Box<Account<'info, Publisher>>,

    #[account(
        mut,
        seeds = [BOND_VAULT_SEED, publisher_account.publisher_key.as_ref()],
        bump,
    )]
    pub publisher_bond_vault: Box<Account<'info, TokenAccount>>,

    /// Protocol treasury USDC vault — validated against `config.protocol_treasury_vault`
    /// in the handler.  All slashed funds route here (no challenger to split with).
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

/// Step 1 of admin transfer (v0.8): only the current admin can propose.
#[derive(Accounts)]
pub struct ProposeAdminTransfer<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ OracleError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,

    pub admin: Signer<'info>,
}

/// Step 2 of admin transfer (v0.8): only the proposed new admin can accept.
#[derive(Accounts)]
pub struct AcceptAdminTransfer<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.pending_admin == new_admin.key() @ OracleError::Unauthorized,
    )]
    pub config: Box<Account<'info, Config>>,

    pub new_admin: Signer<'info>,
}
