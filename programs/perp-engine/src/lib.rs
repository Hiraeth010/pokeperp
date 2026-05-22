use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

pub mod errors;
pub mod state;

use errors::PerpError;
use state::*;

// Cross-program account types from the oracle program.
use oracle::state::{IndexState, IndexStatus};

declare_id!("Gtpv6K9Fi3pkYcYZEzqaS8DW2nqDwpwPf24Q1WxsQzsa");

#[program]
pub mod perp_engine {
    use super::*;

    /// Initialize the Market PDA only. Insurance fund is created separately via
    /// `initialize_insurance_fund` (split to keep `try_accounts` under Solana's 4KB stack cap
    /// — three init accounts in one ix overflowed by ~100 bytes).
    /// Spec: docs/perp-engine.md §2, §9, §11.
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        params: InitializeMarketParams,
    ) -> Result<()> {
        require!(params.oi_floor > 0, PerpError::InvalidConfig);
        require!(
            params.initial_margin_bps > params.maintenance_margin_bps,
            PerpError::InvalidConfig
        );
        require!(params.maintenance_margin_bps > 0, PerpError::InvalidConfig);
        require!(
            params.max_oi_per_side > 0 && params.max_position_per_trader > 0,
            PerpError::InvalidConfig
        );
        require!(
            params.funding_cap_per_hour_bps > 0 && params.funding_cap_per_hour_bps < 10_000,
            PerpError::InvalidConfig
        );
        require!(params.taker_fee_bps < 10_000, PerpError::InvalidConfig);
        require!(
            params.liquidation_penalty_bps < 10_000,
            PerpError::InvalidConfig
        );
        // slippage_factor: stored as ×1e6 (100_000 = 0.10 = 10%). Cap at 1e6 (100%).
        require!(params.slippage_factor <= 1_000_000, PerpError::InvalidConfig);

        let now = Clock::get()?.unix_timestamp;

        // Deterministic InsuranceFund PDA — the account itself may not exist yet
        // (created later by initialize_insurance_fund), but its address is fixed.
        let (insurance_fund_pda, _) =
            Pubkey::find_program_address(&[INSURANCE_FUND_SEED], &crate::ID);

        let market = &mut ctx.accounts.market;
        market.admin = ctx.accounts.admin.key();
        market.oracle_index_state = params.oracle_index_state;
        market.usdc_mint = ctx.accounts.usdc_mint.key();
        market.insurance_fund = insurance_fund_pda;
        market.phase = 0;

        market.slippage_factor = params.slippage_factor;
        market.oi_floor = params.oi_floor;

        market.long_oi = 0;
        market.short_oi = 0;
        market.max_oi_per_side = params.max_oi_per_side;
        market.max_position_per_trader = params.max_position_per_trader;

        market.initial_margin_bps = params.initial_margin_bps;
        market.maintenance_margin_bps = params.maintenance_margin_bps;

        market.funding_cap_per_hour_bps = params.funding_cap_per_hour_bps;
        market.last_funding_update = now;
        market.cumulative_funding_long = 0;
        market.cumulative_funding_short = 0;

        market.mark_twap_1h = 0;
        market.mark_twap_5min = 0;

        market.taker_fee_bps = params.taker_fee_bps;
        market.liquidation_penalty_bps = params.liquidation_penalty_bps;

        market.trading_paused = false;
        market.funding_paused = false;
        market.pause_reason = 0;
        market.mark_deviation_exceeded_since = 0;

        market.bump = ctx.bumps.market;

        Ok(())
    }

    /// Initialize the InsuranceFund metadata PDA and the InsuranceVault token account.
    /// Independent of `initialize_market` — can be called before or after.
    /// Spec: docs/perp-engine.md §7.
    pub fn initialize_insurance_fund(ctx: Context<InitializeInsuranceFund>) -> Result<()> {
        let fund = &mut ctx.accounts.insurance_fund;
        fund.vault = ctx.accounts.insurance_vault.key();
        fund.floor = 25_000_000_000; // 25,000 USDC default floor per perp-engine.md §10
        fund.total_deposited = 0;
        fund.total_paid_out = 0;
        fund.bump = ctx.bumps.insurance_fund;
        Ok(())
    }

    /// Initialize the Treasury metadata PDA and the TreasuryVault token account.
    /// Receives the 90% protocol share of taker fees from open + close.
    /// Spec: docs/perp-engine.md §9.
    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        let t = &mut ctx.accounts.treasury;
        t.vault = ctx.accounts.treasury_vault.key();
        t.total_received = 0;
        t.bump = ctx.bumps.treasury;
        Ok(())
    }

    /// Open a new perp position.
    /// Spec: docs/perp-engine.md §3 (trade execution), §5 (margin), §9 (caps).
    pub fn open_position(ctx: Context<OpenPosition>, size: i64, margin: u64) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(!market.trading_paused, PerpError::TradingPaused);
        require!(size != 0, PerpError::ZeroSize);

        let abs_size = size.unsigned_abs();
        require!(
            abs_size <= market.max_position_per_trader,
            PerpError::PositionTooLarge
        );

        // Apply OI delta and enforce per-side cap.
        let is_long = size > 0;
        let (new_long_oi, new_short_oi) = if is_long {
            let new = market
                .long_oi
                .checked_add(abs_size)
                .ok_or(PerpError::OICapExceeded)?;
            require!(new <= market.max_oi_per_side, PerpError::OICapExceeded);
            (new, market.short_oi)
        } else {
            let new = market
                .short_oi
                .checked_add(abs_size)
                .ok_or(PerpError::OICapExceeded)?;
            require!(new <= market.max_oi_per_side, PerpError::OICapExceeded);
            (market.long_oi, new)
        };

        // Cross-program read: pull the oracle's current index value.
        let index_state = &ctx.accounts.index_state;
        require!(
            index_state.status == IndexStatus::Provisional
                || index_state.status == IndexStatus::Final,
            PerpError::OracleStale
        );
        let index_price = index_state.index_value;
        require!(index_price > 0, PerpError::OracleStale);

        // Mark price uses POST-trade imbalance so the trader experiences the slippage they cause.
        let mark_price = compute_mark_price(
            index_price,
            new_long_oi,
            new_short_oi,
            market.oi_floor,
            market.slippage_factor,
        )?;

        // Initial margin requirement: margin ≥ |size| × IM%.
        let required_margin = (abs_size as u128)
            .checked_mul(market.initial_margin_bps as u128)
            .and_then(|x| x.checked_div(10_000))
            .ok_or(PerpError::MathOverflow)? as u64;
        require!(margin >= required_margin, PerpError::InsufficientMargin);

        // Taker fee: |size| × fee_bps.
        let taker_fee = (abs_size as u128)
            .checked_mul(market.taker_fee_bps as u128)
            .and_then(|x| x.checked_div(10_000))
            .ok_or(PerpError::MathOverflow)? as u64;

        // Move margin into the per-position vault.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.trader_usdc_account.to_account_info(),
                    to: ctx.accounts.margin_vault.to_account_info(),
                    authority: ctx.accounts.trader.to_account_info(),
                },
            ),
            margin,
        )?;

        // Split the taker fee 90% protocol treasury / 10% insurance per spec §9.
        // v0.3 replaced the v0.2 "100% to insurance" simplification.
        let treasury_fee = taker_fee
            .checked_mul(9)
            .and_then(|x| x.checked_div(10))
            .ok_or(PerpError::MathOverflow)?;
        let insurance_fee = taker_fee
            .checked_sub(treasury_fee)
            .ok_or(PerpError::MathOverflow)?;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.trader_usdc_account.to_account_info(),
                    to: ctx.accounts.treasury_vault.to_account_info(),
                    authority: ctx.accounts.trader.to_account_info(),
                },
            ),
            treasury_fee,
        )?;
        ctx.accounts.treasury.total_received = ctx
            .accounts
            .treasury
            .total_received
            .checked_add(treasury_fee)
            .ok_or(PerpError::MathOverflow)?;
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.trader_usdc_account.to_account_info(),
                    to: ctx.accounts.insurance_vault.to_account_info(),
                    authority: ctx.accounts.trader.to_account_info(),
                },
            ),
            insurance_fee,
        )?;
        ctx.accounts.insurance_fund.total_deposited = ctx
            .accounts
            .insurance_fund
            .total_deposited
            .checked_add(insurance_fee)
            .ok_or(PerpError::MathOverflow)?;

        // Write Position.
        let position = &mut ctx.accounts.position;
        position.trader = ctx.accounts.trader.key();
        position.market = market.key();
        position.size = size;
        position.entry_index_price = index_price;
        position.entry_mark_price = mark_price;
        position.margin_vault = ctx.accounts.margin_vault.key();
        position.cumulative_funding_snapshot = if is_long {
            market.cumulative_funding_long
        } else {
            market.cumulative_funding_short
        };
        position.opened_at = Clock::get()?.unix_timestamp;
        position.bump = ctx.bumps.position;

        // Commit market OI updates.
        market.long_oi = new_long_oi;
        market.short_oi = new_short_oi;

        // Mark TWAPs reflect the post-trade observation.
        update_mark_twaps(market, mark_price)?;

        Ok(())
    }


    /// Modify an existing position by `delta_size` (same-side only in v0.2; no flips).
    /// Spec: docs/perp-engine.md §3 execution.
    ///
    /// v0.2 flow:
    /// - Settles per-position funding (against OLD size) into the insurance vault
    ///   BEFORE changing size, so funding accrued on the pre-modify size doesn't
    ///   leak when the post-modify size carries the old snapshot forward.
    /// - Re-snapshots `cumulative_funding_snapshot` to current so the next close
    ///   / modify only sees post-modify funding.
    /// - Updates mark TWAPs with the post-modify mark.
    ///
    /// Still v0.2 simplifications:
    /// - Same-side only (delta must not change the sign of position.size)
    /// - No price-PnL realization on partial close, no entry-price weighted averaging
    /// - No taker fee
    /// - To flip side, the trader must close and reopen
    pub fn modify_position(ctx: Context<ModifyPosition>, delta_size: i64) -> Result<()> {
        require!(
            !ctx.accounts.market.trading_paused,
            PerpError::TradingPaused
        );
        require!(delta_size != 0, PerpError::ZeroSize);

        let old_size = ctx.accounts.position.size;
        let new_size = old_size
            .checked_add(delta_size)
            .ok_or(PerpError::MathOverflow)?;
        require!(new_size != 0, PerpError::ZeroSize); // use close_position for full close

        // No side flips: sign must match
        require!(
            (old_size > 0) == (new_size > 0),
            PerpError::InvalidConfig
        );

        let new_abs = new_size.unsigned_abs();
        require!(
            new_abs <= ctx.accounts.market.max_position_per_trader,
            PerpError::PositionTooLarge
        );

        // ----- Funding settlement against OLD size -----
        // Insurance vault mediates funding flow (zero-sum between longs/shorts but
        // not directly paired in v0.2). Same pattern as close_position. After this
        // block the margin vault balance has changed (paid out or received in) and
        // the position snapshot is current. Spec: docs/perp-engine.md §4.
        let cumulative = ctx.accounts.market.cumulative_funding_long;
        let funding_owed = position_funding_owed(
            cumulative,
            ctx.accounts.position.cumulative_funding_snapshot,
            old_size,
        )?;

        let trader_key = ctx.accounts.trader.key();
        let market_key = ctx.accounts.market.key();
        let position_bump = ctx.accounts.position.bump;
        let position_seeds: &[&[u8]] = &[
            POSITION_SEED,
            trader_key.as_ref(),
            market_key.as_ref(),
            std::slice::from_ref(&position_bump),
        ];
        let position_signer: &[&[&[u8]]] = &[position_seeds];

        if funding_owed > 0 {
            // Trader pays funding into insurance.
            let amount = funding_owed as u64;
            require!(
                ctx.accounts.margin_vault.amount >= amount,
                PerpError::InsufficientMargin
            );
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.margin_vault.to_account_info(),
                        to: ctx.accounts.insurance_vault.to_account_info(),
                        authority: ctx.accounts.position.to_account_info(),
                    },
                    position_signer,
                ),
                amount,
            )?;
            ctx.accounts.insurance_fund.total_deposited = ctx
                .accounts
                .insurance_fund
                .total_deposited
                .checked_add(amount)
                .ok_or(PerpError::MathOverflow)?;
        } else if funding_owed < 0 {
            // Insurance pays funding to trader's margin vault.
            let amount = (-funding_owed) as u64;
            require!(
                ctx.accounts.insurance_vault.amount >= amount,
                PerpError::InsuranceBelowFloor
            );
            let fund_bump = ctx.accounts.insurance_fund.bump;
            let fund_seeds: &[&[u8]] =
                &[INSURANCE_FUND_SEED, std::slice::from_ref(&fund_bump)];
            let fund_signer: &[&[&[u8]]] = &[fund_seeds];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.insurance_vault.to_account_info(),
                        to: ctx.accounts.margin_vault.to_account_info(),
                        authority: ctx.accounts.insurance_fund.to_account_info(),
                    },
                    fund_signer,
                ),
                amount,
            )?;
            ctx.accounts.insurance_fund.total_paid_out = ctx
                .accounts
                .insurance_fund
                .total_paid_out
                .checked_add(amount)
                .ok_or(PerpError::MathOverflow)?;
        }

        // Re-snapshot so any future funding accrual on this position starts from
        // the post-settlement accumulator value.
        ctx.accounts.position.cumulative_funding_snapshot = cumulative;

        // ----- Size + OI update -----
        let old_abs = old_size.unsigned_abs();
        let is_long = old_size > 0;
        let (new_long_oi, new_short_oi) = if is_long {
            let new_long = ctx
                .accounts
                .market
                .long_oi
                .checked_sub(old_abs)
                .and_then(|v| v.checked_add(new_abs))
                .ok_or(PerpError::MathOverflow)?;
            require!(
                new_long <= ctx.accounts.market.max_oi_per_side,
                PerpError::OICapExceeded
            );
            (new_long, ctx.accounts.market.short_oi)
        } else {
            let new_short = ctx
                .accounts
                .market
                .short_oi
                .checked_sub(old_abs)
                .and_then(|v| v.checked_add(new_abs))
                .ok_or(PerpError::MathOverflow)?;
            require!(
                new_short <= ctx.accounts.market.max_oi_per_side,
                PerpError::OICapExceeded
            );
            (ctx.accounts.market.long_oi, new_short)
        };

        // Re-check IM against FRESH margin (post-funding settlement).
        ctx.accounts.margin_vault.reload()?;
        let margin = ctx.accounts.margin_vault.amount;
        let required_im = (new_abs as u128)
            .checked_mul(ctx.accounts.market.initial_margin_bps as u128)
            .and_then(|x| x.checked_div(10_000))
            .ok_or(PerpError::MathOverflow)? as u64;
        require!(margin >= required_im, PerpError::InsufficientMargin);

        // ----- Mark + TWAP update -----
        let index_state = &ctx.accounts.index_state;
        require!(
            index_state.status == IndexStatus::Provisional
                || index_state.status == IndexStatus::Final,
            PerpError::OracleStale
        );
        let index_price = index_state.index_value;
        require!(index_price > 0, PerpError::OracleStale);
        let new_mark_price = compute_mark_price(
            index_price,
            new_long_oi,
            new_short_oi,
            ctx.accounts.market.oi_floor,
            ctx.accounts.market.slippage_factor,
        )?;

        let market = &mut ctx.accounts.market;
        market.long_oi = new_long_oi;
        market.short_oi = new_short_oi;
        update_mark_twaps(market, new_mark_price)?;

        ctx.accounts.position.size = new_size;
        Ok(())
    }

    /// Close an open position in full. Pays out margin + PnL (or 0 if underwater).
    /// Margin vault and Position account are both closed; their rent goes to the trader.
    /// Spec: docs/perp-engine.md §3 (close uses mark price), §5 (margin payout).
    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        let position = &ctx.accounts.position;

        require!(
            !ctx.accounts.market.trading_paused,
            PerpError::TradingPaused
        );

        let is_long = position.size > 0;
        let abs_size = position.size.unsigned_abs();

        // Compute post-close OI.
        let (new_long_oi, new_short_oi) = if is_long {
            (
                ctx.accounts
                    .market
                    .long_oi
                    .checked_sub(abs_size)
                    .ok_or(PerpError::MathOverflow)?,
                ctx.accounts.market.short_oi,
            )
        } else {
            (
                ctx.accounts.market.long_oi,
                ctx.accounts
                    .market
                    .short_oi
                    .checked_sub(abs_size)
                    .ok_or(PerpError::MathOverflow)?,
            )
        };

        // Cross-program: current index from oracle.
        let index_state = &ctx.accounts.index_state;
        require!(
            index_state.status == IndexStatus::Provisional
                || index_state.status == IndexStatus::Final,
            PerpError::OracleStale
        );
        let index_price = index_state.index_value;
        require!(index_price > 0, PerpError::OracleStale);

        // Close mark price uses POST-close imbalance (trader exits at the cleaner price).
        let close_mark_price = compute_mark_price(
            index_price,
            new_long_oi,
            new_short_oi,
            ctx.accounts.market.oi_floor,
            ctx.accounts.market.slippage_factor,
        )?;

        // PnL = size × (close_mark - entry_mark) / entry_mark
        // Signs flow naturally: size carries direction, price_delta carries movement.
        let entry_mark = position.entry_mark_price;
        require!(entry_mark > 0, PerpError::MathOverflow);
        let price_delta = (close_mark_price as i128) - (entry_mark as i128);
        let price_pnl = (position.size as i128)
            .checked_mul(price_delta)
            .and_then(|x| x.checked_div(entry_mark as i128))
            .ok_or(PerpError::MathOverflow)?;

        // Per-position funding: longs paying / shorts receiving (or vice versa) at
        // the rate accrued in the market accumulator since this position's snapshot.
        // Folded into PnL so the existing insurance-mediated settlement below moves
        // the cash to/from the insurance vault automatically. Spec: docs/perp-engine.md §4.
        let funding_owed = position_funding_owed(
            ctx.accounts.market.cumulative_funding_long,
            position.cumulative_funding_snapshot,
            position.size,
        )?;

        // Close-side taker fee: |size| × fee_bps, split 90/10 per spec §9. The
        // treasury share moves out of the margin vault directly via a PDA-signed
        // SPL transfer (position PDA is the margin vault authority); the insurance
        // share folds into pnl so the existing insurance-mediated settlement
        // below routes it through the standard top-up / sweep path.
        let close_fee_total: u64 = (abs_size as u128)
            .checked_mul(ctx.accounts.market.taker_fee_bps as u128)
            .and_then(|x| x.checked_div(10_000))
            .ok_or(PerpError::MathOverflow)? as u64;
        let close_fee_treasury = close_fee_total
            .checked_mul(9)
            .and_then(|x| x.checked_div(10))
            .ok_or(PerpError::MathOverflow)?;
        let close_fee_insurance = close_fee_total
            .checked_sub(close_fee_treasury)
            .ok_or(PerpError::MathOverflow)?;

        // Transfer the treasury share now so it's out of the vault before the
        // settlement math below reads `margin`. Signed by position PDA.
        if close_fee_treasury > 0 {
            let trader_key_ = ctx.accounts.trader.key();
            let market_key_ = ctx.accounts.market.key();
            let position_bump_ = position.bump;
            let position_seeds_: &[&[u8]] = &[
                POSITION_SEED,
                trader_key_.as_ref(),
                market_key_.as_ref(),
                std::slice::from_ref(&position_bump_),
            ];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.margin_vault.to_account_info(),
                        to: ctx.accounts.treasury_vault.to_account_info(),
                        authority: ctx.accounts.position.to_account_info(),
                    },
                    &[position_seeds_],
                ),
                close_fee_treasury,
            )?;
            ctx.accounts.treasury.total_received = ctx
                .accounts
                .treasury
                .total_received
                .checked_add(close_fee_treasury)
                .ok_or(PerpError::MathOverflow)?;
        }

        let pnl = price_pnl
            .checked_sub(funding_owed)
            .and_then(|x| x.checked_sub(close_fee_insurance as i128))
            .ok_or(PerpError::MathOverflow)?;

        // Reload margin vault — treasury transfer above debited it.
        ctx.accounts.margin_vault.reload()?;
        let margin = ctx.accounts.margin_vault.amount;
        let payout_signed = (margin as i128)
            .checked_add(pnl)
            .ok_or(PerpError::MathOverflow)?;
        // Underwater positions should have been liquidated; reverting here protects the program.
        require!(payout_signed >= 0, PerpError::InsufficientMargin);
        let payout = payout_signed as u64;

        // PnL settlement via the insurance vault:
        //  - pnl > 0 (trader wins): insurance tops up the margin vault by `pnl` BEFORE the
        //    payout transfer, so the vault drains to exactly zero.
        //  - pnl < 0 (trader loses): payout already smaller than margin; after the payout
        //    transfer the residual |pnl| is swept from the margin vault into insurance.
        //  - pnl == 0: no insurance interaction needed.
        if pnl > 0 {
            let pnl_amount = pnl as u64;
            require!(
                ctx.accounts.insurance_vault.amount >= pnl_amount,
                PerpError::InsuranceBelowFloor
            );
            let fund_bump = ctx.accounts.insurance_fund.bump;
            let fund_seeds: &[&[u8]] = &[
                INSURANCE_FUND_SEED,
                std::slice::from_ref(&fund_bump),
            ];
            let fund_signer_seeds: &[&[&[u8]]] = &[fund_seeds];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.insurance_vault.to_account_info(),
                        to: ctx.accounts.margin_vault.to_account_info(),
                        authority: ctx.accounts.insurance_fund.to_account_info(),
                    },
                    fund_signer_seeds,
                ),
                pnl_amount,
            )?;
            ctx.accounts.insurance_fund.total_paid_out = ctx
                .accounts
                .insurance_fund
                .total_paid_out
                .checked_add(pnl_amount)
                .ok_or(PerpError::MathOverflow)?;
        }

        // Margin vault authority is the Position PDA — sign outbound transfers with its seeds.
        let trader_key = ctx.accounts.trader.key();
        let market_key = ctx.accounts.market.key();
        let position_bump = position.bump;
        let position_seeds: &[&[u8]] = &[
            POSITION_SEED,
            trader_key.as_ref(),
            market_key.as_ref(),
            std::slice::from_ref(&position_bump),
        ];
        let signer_seeds: &[&[&[u8]]] = &[position_seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.margin_vault.to_account_info(),
                    to: ctx.accounts.trader_usdc_account.to_account_info(),
                    authority: ctx.accounts.position.to_account_info(),
                },
                signer_seeds,
            ),
            payout,
        )?;

        // Negative-PnL sweep: residual loss in the margin vault flows to insurance.
        if pnl < 0 {
            let loss = (-pnl) as u64;
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.margin_vault.to_account_info(),
                        to: ctx.accounts.insurance_vault.to_account_info(),
                        authority: ctx.accounts.position.to_account_info(),
                    },
                    signer_seeds,
                ),
                loss,
            )?;
            ctx.accounts.insurance_fund.total_deposited = ctx
                .accounts
                .insurance_fund
                .total_deposited
                .checked_add(loss)
                .ok_or(PerpError::MathOverflow)?;
        }

        // Reclaim margin vault rent to the trader by closing the (now-empty) token account.
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::CloseAccount {
                account: ctx.accounts.margin_vault.to_account_info(),
                destination: ctx.accounts.trader.to_account_info(),
                authority: ctx.accounts.position.to_account_info(),
            },
            signer_seeds,
        ))?;

        // Update market OI. (Position account itself closed via `close = trader` constraint.)
        let market = &mut ctx.accounts.market;
        market.long_oi = new_long_oi;
        market.short_oi = new_short_oi;

        // Mark TWAPs reflect the post-close observation.
        update_mark_twaps(market, close_mark_price)?;

        // TODO §9: charge close-side taker fee (v0.3).

        Ok(())
    }

    /// Add margin to an open position. No checks beyond non-zero — only ever helps the position.
    /// Spec: docs/perp-engine.md §5.
    pub fn add_margin(ctx: Context<AddMargin>, amount: u64) -> Result<()> {
        require!(amount > 0, PerpError::InvalidConfig);
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.trader_usdc_account.to_account_info(),
                    to: ctx.accounts.margin_vault.to_account_info(),
                    authority: ctx.accounts.trader.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    /// Withdraw margin (subject to IM check on post-withdrawal balance).
    /// Spec: docs/perp-engine.md §5.
    pub fn withdraw_margin(ctx: Context<WithdrawMargin>, amount: u64) -> Result<()> {
        require!(amount > 0, PerpError::InvalidConfig);
        require!(
            !ctx.accounts.market.trading_paused,
            PerpError::TradingPaused
        );

        let current = ctx.accounts.margin_vault.amount;
        require!(current >= amount, PerpError::InsufficientMargin);
        let post = current - amount;

        let abs_size = ctx.accounts.position.size.unsigned_abs();
        let required_im = (abs_size as u128)
            .checked_mul(ctx.accounts.market.initial_margin_bps as u128)
            .and_then(|x| x.checked_div(10_000))
            .ok_or(PerpError::MathOverflow)? as u64;
        require!(post >= required_im, PerpError::WithdrawalBlockedByMargin);

        // PDA-signed transfer: margin vault authority = position PDA.
        let trader_key = ctx.accounts.trader.key();
        let market_key = ctx.accounts.market.key();
        let position_bump = ctx.accounts.position.bump;
        let seeds: &[&[u8]] = &[
            POSITION_SEED,
            trader_key.as_ref(),
            market_key.as_ref(),
            std::slice::from_ref(&position_bump),
        ];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.margin_vault.to_account_info(),
                    to: ctx.accounts.trader_usdc_account.to_account_info(),
                    authority: ctx.accounts.position.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;
        Ok(())
    }

    /// Liquidate a position that has breached maintenance margin.
    /// Anyone can call. `liq_ref_price` favors the liquidatee
    /// (min of index and mark_twap_5min for longs, max for shorts).
    /// Penalty 1.5% of notional: 1/3 to liquidator, 2/3 to insurance fund.
    /// Spec: docs/perp-engine.md §6.
    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        // Oracle index check
        let index_state = &ctx.accounts.index_state;
        require!(
            index_state.status == IndexStatus::Provisional
                || index_state.status == IndexStatus::Final,
            PerpError::OracleStale
        );
        let index_price = index_state.index_value;
        require!(index_price > 0, PerpError::OracleStale);

        let position_size = ctx.accounts.position.size;
        let entry_mark = ctx.accounts.position.entry_mark_price;
        require!(entry_mark > 0, PerpError::MathOverflow);

        // liq_ref_price favors the liquidatee
        let mark_twap = ctx.accounts.market.mark_twap_5min;
        let is_long = position_size > 0;
        let liq_ref_price = if is_long {
            if mark_twap > 0 && mark_twap < index_price {
                mark_twap
            } else {
                index_price
            }
        } else if mark_twap > 0 && mark_twap > index_price {
            mark_twap
        } else {
            index_price
        };

        // PnL at liq_ref_price (signed)
        let price_delta = (liq_ref_price as i128) - (entry_mark as i128);
        let price_pnl = (position_size as i128)
            .checked_mul(price_delta)
            .and_then(|x| x.checked_div(entry_mark as i128))
            .ok_or(PerpError::MathOverflow)?;

        // Funding can push an otherwise-solvent position under MM (a long that's
        // been bleeding funding for hours). The accumulator difference flows here
        // too — see close_position for the symmetric path. Spec: docs/perp-engine.md
        // §4, §7.
        let funding_owed = position_funding_owed(
            ctx.accounts.market.cumulative_funding_long,
            ctx.accounts.position.cumulative_funding_snapshot,
            position_size,
        )?;
        let pnl = price_pnl
            .checked_sub(funding_owed)
            .ok_or(PerpError::MathOverflow)?;

        let margin_pre = ctx.accounts.margin_vault.amount;
        let equity = (margin_pre as i128)
            .checked_add(pnl)
            .ok_or(PerpError::MathOverflow)?;

        // MM breach check
        let abs_size = position_size.unsigned_abs();
        let mm_threshold = (abs_size as u128)
            .checked_mul(ctx.accounts.market.maintenance_margin_bps as u128)
            .and_then(|x| x.checked_div(10_000))
            .ok_or(PerpError::MathOverflow)? as i128;
        require!(equity < mm_threshold, PerpError::PositionNotLiquidatable);

        // ----- Funding cash flow -----
        // Mirror close_position's settlement, but at liquidation we settle BEFORE the
        // penalty split so the penalty distributes from the post-funding margin.
        //  - funding_owed > 0: trader pays funding; cap at margin to avoid underflow,
        //    insurance keeps whatever was there.
        //  - funding_owed < 0: trader is owed funding; insurance vault pays in
        //    (revert if it can't — v0.3 ADL fallback would handle this case).
        let trader_key = ctx.accounts.trader.key();
        let market_key = ctx.accounts.market.key();
        let position_bump = ctx.accounts.position.bump;
        let position_seeds: &[&[u8]] = &[
            POSITION_SEED,
            trader_key.as_ref(),
            market_key.as_ref(),
            std::slice::from_ref(&position_bump),
        ];
        let position_signer_seeds: &[&[&[u8]]] = &[position_seeds];

        if funding_owed > 0 {
            let owed = funding_owed as u64;
            let amount = owed.min(margin_pre);
            if amount > 0 {
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        Transfer {
                            from: ctx.accounts.margin_vault.to_account_info(),
                            to: ctx.accounts.insurance_vault.to_account_info(),
                            authority: ctx.accounts.position.to_account_info(),
                        },
                        position_signer_seeds,
                    ),
                    amount,
                )?;
                ctx.accounts.insurance_fund.total_deposited = ctx
                    .accounts
                    .insurance_fund
                    .total_deposited
                    .checked_add(amount)
                    .ok_or(PerpError::MathOverflow)?;
            }
        } else if funding_owed < 0 {
            let owed_to_trader = (-funding_owed) as u64;
            require!(
                ctx.accounts.insurance_vault.amount >= owed_to_trader,
                PerpError::InsuranceBelowFloor
            );
            let fund_bump = ctx.accounts.insurance_fund.bump;
            let fund_seeds: &[&[u8]] =
                &[INSURANCE_FUND_SEED, std::slice::from_ref(&fund_bump)];
            let fund_signer_seeds: &[&[&[u8]]] = &[fund_seeds];
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.insurance_vault.to_account_info(),
                        to: ctx.accounts.margin_vault.to_account_info(),
                        authority: ctx.accounts.insurance_fund.to_account_info(),
                    },
                    fund_signer_seeds,
                ),
                owed_to_trader,
            )?;
            ctx.accounts.insurance_fund.total_paid_out = ctx
                .accounts
                .insurance_fund
                .total_paid_out
                .checked_add(owed_to_trader)
                .ok_or(PerpError::MathOverflow)?;
        }
        // Reload margin vault — post-funding balance feeds the penalty distribution.
        ctx.accounts.margin_vault.reload()?;
        let margin = ctx.accounts.margin_vault.amount;

        // Penalty: 1.5% of |size|, split 1/3 to liquidator + 2/3 to insurance
        let total_penalty = (abs_size as u128)
            .checked_mul(ctx.accounts.market.liquidation_penalty_bps as u128)
            .and_then(|x| x.checked_div(10_000))
            .ok_or(PerpError::MathOverflow)? as u64;
        let liquidator_share = total_penalty / 3;
        let insurance_share = total_penalty - liquidator_share;

        // Distribute from margin vault; payouts are bounded by what's actually in the vault.
        // Shortfall (when margin < total_payouts owed) implicitly burned in v0.2.
        // TODO: insurance fund draw + ADL when shortfall (perp-engine.md §7/§8).
        let mut available = margin;
        let liq_payout = liquidator_share.min(available);
        available = available.saturating_sub(liq_payout);
        let ins_payout = insurance_share.min(available);
        available = available.saturating_sub(ins_payout);
        let trader_payout = available;

        // PDA-signed transfers (position PDA is the margin vault authority)
        // Reuse the position_signer_seeds declared above for the funding-cash-flow
        // step — same PDA signs all outbound transfers from the margin vault.
        let signer_seeds = position_signer_seeds;

        if liq_payout > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.margin_vault.to_account_info(),
                        to: ctx.accounts.liquidator_usdc_account.to_account_info(),
                        authority: ctx.accounts.position.to_account_info(),
                    },
                    signer_seeds,
                ),
                liq_payout,
            )?;
        }
        if ins_payout > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.margin_vault.to_account_info(),
                        to: ctx.accounts.insurance_vault.to_account_info(),
                        authority: ctx.accounts.position.to_account_info(),
                    },
                    signer_seeds,
                ),
                ins_payout,
            )?;
            ctx.accounts.insurance_fund.total_deposited = ctx
                .accounts
                .insurance_fund
                .total_deposited
                .checked_add(ins_payout)
                .ok_or(PerpError::MathOverflow)?;
        }
        if trader_payout > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.margin_vault.to_account_info(),
                        to: ctx.accounts.trader_usdc_account.to_account_info(),
                        authority: ctx.accounts.position.to_account_info(),
                    },
                    signer_seeds,
                ),
                trader_payout,
            )?;
        }

        // Close margin vault, rent flows to trader
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::CloseAccount {
                account: ctx.accounts.margin_vault.to_account_info(),
                destination: ctx.accounts.trader.to_account_info(),
                authority: ctx.accounts.position.to_account_info(),
            },
            signer_seeds,
        ))?;

        // Update market OI (Position account closed via `close = trader` constraint)
        let market = &mut ctx.accounts.market;
        if is_long {
            market.long_oi = market.long_oi.saturating_sub(abs_size);
        } else {
            market.short_oi = market.short_oi.saturating_sub(abs_size);
        }
        Ok(())
    }

    /// Advance the market's cumulative funding accumulator.
    /// Anyone can call. Each hour elapsed since `last_funding_update` adds one rate's worth
    /// to the accumulator, capped at `funding_cap_per_hour_bps`. Positions read the accumulator
    /// at trade time (open/close) and settle their own accrual against `cumulative_funding_snapshot`.
    /// Spec: docs/perp-engine.md §4.
    ///
    /// v0.1 simplification: this only updates the global accumulator. Per-position settlement
    /// (transferring USDC between long and short positions) is deferred — close_position would
    /// need to apply the funding delta from `position.cumulative_funding_snapshot` to the payout.
    pub fn settle_funding(ctx: Context<SettleFunding>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(!market.funding_paused, PerpError::FundingPaused);

        let now = Clock::get()?.unix_timestamp;
        let elapsed = (now - market.last_funding_update).max(0);
        if elapsed < 3600 {
            return Ok(()); // less than one hour since last update; nothing to accrue
        }
        let hours = (elapsed / 3600) as i128;

        let index_price = ctx.accounts.index_state.index_value;
        require!(index_price > 0, PerpError::OracleStale);

        let mark = market.mark_twap_1h;
        if mark > 0 {
            // funding_rate (×1e6 scale) = (mark - index) × 1e6 / index
            let delta = (mark as i128) - (index_price as i128);
            let rate = delta
                .checked_mul(1_000_000)
                .and_then(|x| x.checked_div(index_price as i128))
                .ok_or(PerpError::MathOverflow)?;

            // Clamp to ±cap. Cap is bps; convert to ×1e6 scale by ×100.
            let cap_scaled = (market.funding_cap_per_hour_bps as i128) * 100;
            let clamped = rate.max(-cap_scaled).min(cap_scaled);

            let accrual = clamped
                .checked_mul(hours)
                .ok_or(PerpError::MathOverflow)?;

            market.cumulative_funding_long = market
                .cumulative_funding_long
                .checked_add(accrual)
                .ok_or(PerpError::MathOverflow)?;
            // Funding is zero-sum: same accumulator; per-position sign applied at settle time.
            market.cumulative_funding_short = market.cumulative_funding_long;
        }

        // Advance the timestamp by complete hours only — fractional hours stay in the residual.
        market.last_funding_update = market
            .last_funding_update
            .checked_add((hours as i64) * 3600)
            .ok_or(PerpError::MathOverflow)?;
        Ok(())
    }

    /// Force-close a profitable position when the insurance fund is below floor.
    /// Caller specifies which position to ADL (the off-chain ranking by pnl/margin is the caller's
    /// responsibility — Solana programs can't iterate program accounts in-instruction).
    /// Spec: docs/perp-engine.md §8.
    ///
    /// v0.1 simplifications:
    /// - No on-chain ranking check (caller asserts the position is the most profitable)
    /// - Closes at current index price (no mark slippage), no penalty
    /// - Pays out margin + pnl to the ADL'd trader
    pub fn auto_deleverage(ctx: Context<AutoDeleverage>) -> Result<()> {
        // Insurance below floor — entry condition for ADL
        let fund = &ctx.accounts.insurance_fund;
        let fund_balance = fund.total_deposited.saturating_sub(fund.total_paid_out);
        require!(fund_balance < fund.floor, PerpError::InsuranceBelowFloor);

        // Oracle index
        let index_state = &ctx.accounts.index_state;
        require!(
            index_state.status == IndexStatus::Provisional
                || index_state.status == IndexStatus::Final,
            PerpError::OracleStale
        );
        let index_price = index_state.index_value;
        require!(index_price > 0, PerpError::OracleStale);

        let position_size = ctx.accounts.position.size;
        let entry_mark = ctx.accounts.position.entry_mark_price;
        require!(entry_mark > 0, PerpError::MathOverflow);

        // PnL at index price (no mark slippage for ADL — fair value)
        let price_delta = (index_price as i128) - (entry_mark as i128);
        let pnl = (position_size as i128)
            .checked_mul(price_delta)
            .and_then(|x| x.checked_div(entry_mark as i128))
            .ok_or(PerpError::MathOverflow)?;

        let margin = ctx.accounts.margin_vault.amount;
        let payout = ((margin as i128)
            .checked_add(pnl)
            .ok_or(PerpError::MathOverflow)?)
        .max(0) as u64;

        // PDA-signed transfer
        let trader_key = ctx.accounts.trader.key();
        let market_key = ctx.accounts.market.key();
        let position_bump = ctx.accounts.position.bump;
        let seeds: &[&[u8]] = &[
            POSITION_SEED,
            trader_key.as_ref(),
            market_key.as_ref(),
            std::slice::from_ref(&position_bump),
        ];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        if payout > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.margin_vault.to_account_info(),
                        to: ctx.accounts.trader_usdc_account.to_account_info(),
                        authority: ctx.accounts.position.to_account_info(),
                    },
                    signer_seeds,
                ),
                payout,
            )?;
        }
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::CloseAccount {
                account: ctx.accounts.margin_vault.to_account_info(),
                destination: ctx.accounts.trader.to_account_info(),
                authority: ctx.accounts.position.to_account_info(),
            },
            signer_seeds,
        ))?;

        // OI update (position closed via close=trader constraint)
        let market = &mut ctx.accounts.market;
        let abs_size = position_size.unsigned_abs();
        if position_size > 0 {
            market.long_oi = market.long_oi.saturating_sub(abs_size);
        } else {
            market.short_oi = market.short_oi.saturating_sub(abs_size);
        }
        Ok(())
    }

    /// Admin emergency pause / unpause for trading and funding.
    /// Spec: docs/perp-engine.md §10.
    pub fn set_pause(
        ctx: Context<SetPause>,
        trading_paused: bool,
        funding_paused: bool,
        reason: u8,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        market.trading_paused = trading_paused;
        market.funding_paused = funding_paused;
        market.pause_reason = reason;
        Ok(())
    }

    /// Advance phase parameters per phase schedule.
    /// Spec: docs/perp-engine.md §11.
    pub fn set_phase(ctx: Context<SetPhase>, new_phase: u8) -> Result<()> {
        require!(new_phase <= 3, PerpError::InvalidConfig);
        let market = &mut ctx.accounts.market;
        market.phase = new_phase;

        // Phase-dependent param updates per perp-engine.md §11.
        match new_phase {
            1 => {
                // Phase 1: 3× leverage (33% IM / 16.5% MM), 50k per-trader, 500k OI, 0.10%/hr cap.
                market.initial_margin_bps = 3300;
                market.maintenance_margin_bps = 1650;
                market.max_oi_per_side = 500_000_000_000;
                market.max_position_per_trader = 50_000_000_000;
                market.funding_cap_per_hour_bps = 10;
                market.slippage_factor = 100_000;
            }
            2 => {
                // Phase 2: 5× leverage (20% IM / 10% MM), 250k per-trader, 5M OI, 0.50%/hr cap.
                market.initial_margin_bps = 2000;
                market.maintenance_margin_bps = 1000;
                market.max_oi_per_side = 5_000_000_000_000;
                market.max_position_per_trader = 250_000_000_000;
                market.funding_cap_per_hour_bps = 50;
                market.slippage_factor = 50_000;
            }
            _ => {} // Phase 0 (shadow) and Phase 3 (orderbook v2) leave Market unchanged.
        }

        Ok(())
    }
}

/// Compute mark price from index and post-trade OI.
/// `mark = index × (1 + slippage_factor × imbalance)` where
/// `imbalance = (long_oi - short_oi) / max(long_oi + short_oi, oi_floor)`.
/// All fixed-point: slippage_factor scaled ×1e6, imbalance scaled ×1e6 internally.
/// Spec: docs/perp-engine.md §3.
fn compute_mark_price(
    index_price: u64,
    long_oi: u64,
    short_oi: u64,
    oi_floor: u64,
    slippage_factor: u32,
) -> Result<u64> {
    let total_oi = long_oi.saturating_add(short_oi);
    let denom = total_oi.max(oi_floor);
    if denom == 0 {
        return Ok(index_price);
    }

    let net_signed = (long_oi as i128) - (short_oi as i128);
    // imbalance scaled by 1e6: range roughly [-1e6, +1e6]
    let imbalance_scaled = net_signed
        .checked_mul(1_000_000)
        .and_then(|x| x.checked_div(denom as i128))
        .ok_or(PerpError::MathOverflow)?;

    // slippage_factor (×1e6) × imbalance_scaled (×1e6) → ×1e12 adjustment.
    let adj = (slippage_factor as i128)
        .checked_mul(imbalance_scaled)
        .ok_or(PerpError::MathOverflow)?;

    // delta = index × adj / 1e12
    let delta = (index_price as i128)
        .checked_mul(adj)
        .and_then(|x| x.checked_div(1_000_000_000_000))
        .ok_or(PerpError::MathOverflow)?;

    let mark = (index_price as i128)
        .checked_add(delta)
        .ok_or(PerpError::MathOverflow)?;
    require!(mark > 0, PerpError::MathOverflow);
    Ok(mark as u64)
}

/// EMA update: result = (new + (denom-1) × old) / denom. First observation
/// (old == 0 sentinel) sets the value directly.
fn ema_update(old: u64, new: u64, denom: u64) -> Result<u64> {
    if old == 0 {
        return Ok(new);
    }
    let updated = (new as u128)
        .checked_add((denom - 1) as u128 * old as u128)
        .ok_or(PerpError::MathOverflow)?
        / denom as u128;
    Ok(updated as u64)
}

/// Update both mark TWAPs in Market with a fresh observation.
/// `mark_twap_1h` uses denom=16 (slow smoothing); `mark_twap_5min` uses denom=4 (fast).
/// v0.2 simplification: fixed-alpha EMA rather than time-weighted, so no per-trade
/// timestamp storage is needed. Good enough for funding-rate trend + liquidation
/// reference; a future version can layer in dt-based weighting.
fn update_mark_twaps(market: &mut Market, observation: u64) -> Result<()> {
    market.mark_twap_1h = ema_update(market.mark_twap_1h, observation, 16)?;
    market.mark_twap_5min = ema_update(market.mark_twap_5min, observation, 4)?;
    Ok(())
}

/// Compute funding owed by a position at settlement time.
///
/// Returns signed micro-USDC: positive = trader pays into the system; negative =
/// trader is owed by the system. Signed `size` (positive long, negative short)
/// folds direction into the formula — a positive funding rate (mark > index)
/// makes longs pay and shorts receive without an explicit branch.
///
/// Caller is responsible for first advancing `market.cumulative_funding_long`
/// via `settle_funding`; this just reads the accumulator.
fn position_funding_owed(cumulative: i128, snapshot: i128, size: i64) -> Result<i128> {
    let delta = cumulative
        .checked_sub(snapshot)
        .ok_or(PerpError::MathOverflow)?;
    (size as i128)
        .checked_mul(delta)
        .and_then(|x| x.checked_div(1_000_000))
        .ok_or(PerpError::MathOverflow.into())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeMarketParams {
    pub oracle_index_state: Pubkey,
    pub usdc_mint: Pubkey,
    pub insurance_vault: Pubkey,
    pub slippage_factor: u32,
    pub oi_floor: u64,
    pub initial_margin_bps: u16,
    pub maintenance_margin_bps: u16,
    pub funding_cap_per_hour_bps: u16,
    pub taker_fee_bps: u16,
    pub liquidation_penalty_bps: u16,
    pub max_oi_per_side: u64,
    pub max_position_per_trader: u64,
}

// ---------- Accounts contexts (stubbed; expand when implementing) ----------

#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED],
        bump,
    )]
    pub market: Box<Account<'info, Market>>,

    /// Mint is read for validation only (Market stores its pubkey); not initialized here.
    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeInsuranceFund<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + InsuranceFund::INIT_SPACE,
        seeds = [INSURANCE_FUND_SEED],
        bump,
    )]
    pub insurance_fund: Box<Account<'info, InsuranceFund>>,

    #[account(
        init,
        payer = admin,
        seeds = [INSURANCE_VAULT_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = insurance_fund,
    )]
    pub insurance_vault: Box<Account<'info, TokenAccount>>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + Treasury::INIT_SPACE,
        seeds = [TREASURY_SEED],
        bump,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    #[account(
        init,
        payer = admin,
        seeds = [TREASURY_VAULT_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = treasury,
    )]
    pub treasury_vault: Box<Account<'info, TokenAccount>>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    // Heavy accounts are Box'd to keep `try_accounts` stack frame under Solana's 4KB cap.
    #[account(mut, seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,

    #[account(mut)]
    pub trader: Signer<'info>,

    /// One position per (trader, market). Init fails if a position already exists.
    #[account(
        init,
        payer = trader,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, trader.key().as_ref(), market.key().as_ref()],
        bump,
    )]
    pub position: Box<Account<'info, Position>>,

    /// Per-position margin vault PDA, authority = the position itself.
    /// Outbound transfers (close / liquidation) sign with position PDA seeds.
    #[account(
        init,
        payer = trader,
        seeds = [MARGIN_VAULT_SEED, trader.key().as_ref(), market.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = position,
    )]
    pub margin_vault: Box<Account<'info, TokenAccount>>,

    /// Trader's USDC source — pays margin + fee.
    #[account(mut, token::mint = usdc_mint, token::authority = trader)]
    pub trader_usdc_account: Box<Account<'info, TokenAccount>>,

    /// Insurance vault — receives 10% of the taker fee.
    #[account(
        mut,
        seeds = [INSURANCE_VAULT_SEED],
        bump,
    )]
    pub insurance_vault: Box<Account<'info, TokenAccount>>,

    /// Insurance fund metadata — total_deposited tracks the cumulative inflow of
    /// taker fees + loss sweeps so the on-chain field matches actual vault balance.
    #[account(
        mut,
        seeds = [INSURANCE_FUND_SEED],
        bump = insurance_fund.bump,
    )]
    pub insurance_fund: Box<Account<'info, InsuranceFund>>,

    /// Treasury vault — receives 90% of the taker fee (spec §9).
    #[account(
        mut,
        seeds = [TREASURY_VAULT_SEED],
        bump,
    )]
    pub treasury_vault: Box<Account<'info, TokenAccount>>,

    /// Treasury metadata — total_received tracks cumulative protocol-share fees.
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump = treasury.bump,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    /// Cross-program account: oracle program's IndexState.
    /// Anchor enforces ownership by the oracle program via the typed `Account<IndexState>`.
    /// Additional constraint pins it to the address recorded on Market at initialization.
    #[account(
        constraint = index_state.key() == market.oracle_index_state @ PerpError::OracleStale,
    )]
    pub index_state: Box<Account<'info, IndexState>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ModifyPosition<'info> {
    #[account(mut, seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,

    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        mut,
        seeds = [POSITION_SEED, trader.key().as_ref(), market.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, Position>>,

    /// Margin vault; authority = position PDA. Mutated during funding settlement.
    #[account(
        mut,
        seeds = [MARGIN_VAULT_SEED, trader.key().as_ref(), market.key().as_ref()],
        bump,
    )]
    pub margin_vault: Box<Account<'info, TokenAccount>>,

    /// Insurance fund metadata — total_deposited / total_paid_out updated by
    /// funding settlement.
    #[account(
        mut,
        seeds = [INSURANCE_FUND_SEED],
        bump = insurance_fund.bump,
    )]
    pub insurance_fund: Box<Account<'info, InsuranceFund>>,

    /// Insurance vault — receives positive funding, source of negative funding.
    /// Authority = insurance_fund PDA.
    #[account(
        mut,
        seeds = [INSURANCE_VAULT_SEED],
        bump,
    )]
    pub insurance_vault: Box<Account<'info, TokenAccount>>,

    /// Oracle index for the post-modify mark price computation.
    #[account(
        constraint = index_state.key() == market.oracle_index_state @ PerpError::OracleStale,
    )]
    pub index_state: Box<Account<'info, IndexState>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    // Heavy accounts are Box'd to keep `try_accounts` stack frame under Solana's 4KB cap.
    #[account(mut, seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,

    #[account(mut)]
    pub trader: Signer<'info>,

    /// Closed at end of instruction; rent flows to trader.
    #[account(
        mut,
        close = trader,
        seeds = [POSITION_SEED, trader.key().as_ref(), market.key().as_ref()],
        bump = position.bump,
        constraint = position.trader == trader.key() @ PerpError::Unauthorized,
        constraint = position.market == market.key() @ PerpError::Unauthorized,
    )]
    pub position: Box<Account<'info, Position>>,

    /// Margin vault PDA; authority = position PDA. Closed inside the handler.
    #[account(
        mut,
        seeds = [MARGIN_VAULT_SEED, trader.key().as_ref(), market.key().as_ref()],
        bump,
    )]
    pub margin_vault: Box<Account<'info, TokenAccount>>,

    /// Trader's USDC destination for payout.
    #[account(mut, token::mint = usdc_mint, token::authority = trader)]
    pub trader_usdc_account: Box<Account<'info, TokenAccount>>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    /// Insurance fund metadata — tracks total_deposited / total_paid_out across closes.
    #[account(
        mut,
        seeds = [INSURANCE_FUND_SEED],
        bump = insurance_fund.bump,
    )]
    pub insurance_fund: Box<Account<'info, InsuranceFund>>,

    /// Insurance vault — receives loss sweeps + 10% close fee, source of win top-ups.
    /// Authority = insurance_fund PDA.
    #[account(
        mut,
        seeds = [INSURANCE_VAULT_SEED],
        bump,
    )]
    pub insurance_vault: Box<Account<'info, TokenAccount>>,

    /// Treasury vault — receives 90% close fee on close.
    #[account(
        mut,
        seeds = [TREASURY_VAULT_SEED],
        bump,
    )]
    pub treasury_vault: Box<Account<'info, TokenAccount>>,

    /// Treasury metadata — total_received bumped by the close-fee treasury share.
    #[account(
        mut,
        seeds = [TREASURY_SEED],
        bump = treasury.bump,
    )]
    pub treasury: Box<Account<'info, Treasury>>,

    #[account(
        constraint = index_state.key() == market.oracle_index_state @ PerpError::OracleStale,
    )]
    pub index_state: Box<Account<'info, IndexState>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AddMargin<'info> {
    #[account(seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,

    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        seeds = [POSITION_SEED, trader.key().as_ref(), market.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        seeds = [MARGIN_VAULT_SEED, trader.key().as_ref(), market.key().as_ref()],
        bump,
    )]
    pub margin_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::authority = trader)]
    pub trader_usdc_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawMargin<'info> {
    #[account(seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,

    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        seeds = [POSITION_SEED, trader.key().as_ref(), market.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        seeds = [MARGIN_VAULT_SEED, trader.key().as_ref(), market.key().as_ref()],
        bump,
    )]
    pub margin_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::authority = trader)]
    pub trader_usdc_account: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut, seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,

    /// Anyone can liquidate.
    #[account(mut)]
    pub liquidator: Signer<'info>,

    /// Trader being liquidated. Rent from closed accounts flows here.
    /// CHECK: address pinned to position.trader via the close constraint below.
    #[account(mut, address = position.trader)]
    pub trader: AccountInfo<'info>,

    #[account(
        mut,
        close = trader,
        seeds = [POSITION_SEED, trader.key().as_ref(), market.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        seeds = [MARGIN_VAULT_SEED, trader.key().as_ref(), market.key().as_ref()],
        bump,
    )]
    pub margin_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = usdc_mint, token::authority = trader)]
    pub trader_usdc_account: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = usdc_mint, token::authority = liquidator)]
    pub liquidator_usdc_account: Box<Account<'info, TokenAccount>>,

    #[account(mut, seeds = [INSURANCE_VAULT_SEED], bump)]
    pub insurance_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, seeds = [INSURANCE_FUND_SEED], bump = insurance_fund.bump)]
    pub insurance_fund: Box<Account<'info, InsuranceFund>>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        constraint = index_state.key() == market.oracle_index_state @ PerpError::OracleStale,
    )]
    pub index_state: Box<Account<'info, IndexState>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SettleFunding<'info> {
    #[account(mut, seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,

    pub caller: Signer<'info>,

    #[account(
        constraint = index_state.key() == market.oracle_index_state @ PerpError::OracleStale,
    )]
    pub index_state: Box<Account<'info, IndexState>>,
}

#[derive(Accounts)]
pub struct AutoDeleverage<'info> {
    #[account(mut, seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,

    /// Anyone can call when insurance is below floor.
    pub caller: Signer<'info>,

    /// Trader whose position is being ADL'd.
    /// CHECK: address pinned to position.trader via close constraint.
    #[account(mut, address = position.trader)]
    pub trader: AccountInfo<'info>,

    #[account(
        mut,
        close = trader,
        seeds = [POSITION_SEED, trader.key().as_ref(), market.key().as_ref()],
        bump = position.bump,
    )]
    pub position: Box<Account<'info, Position>>,

    #[account(
        mut,
        seeds = [MARGIN_VAULT_SEED, trader.key().as_ref(), market.key().as_ref()],
        bump,
    )]
    pub margin_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = usdc_mint, token::authority = trader)]
    pub trader_usdc_account: Box<Account<'info, TokenAccount>>,

    #[account(seeds = [INSURANCE_FUND_SEED], bump = insurance_fund.bump)]
    pub insurance_fund: Box<Account<'info, InsuranceFund>>,

    pub usdc_mint: Box<Account<'info, Mint>>,

    #[account(
        constraint = index_state.key() == market.oracle_index_state @ PerpError::OracleStale,
    )]
    pub index_state: Box<Account<'info, IndexState>>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SetPause<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED],
        bump = market.bump,
        constraint = market.admin == admin.key() @ PerpError::Unauthorized,
    )]
    pub market: Box<Account<'info, Market>>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetPhase<'info> {
    #[account(
        mut,
        seeds = [MARKET_SEED],
        bump = market.bump,
        constraint = market.admin == admin.key() @ PerpError::Unauthorized,
    )]
    pub market: Box<Account<'info, Market>>,

    pub admin: Signer<'info>,
}

#[cfg(test)]
mod funding_tests {
    use super::*;

    const USDC: i64 = 1_000_000;

    #[test]
    fn no_accrual_means_zero_owed() {
        assert_eq!(position_funding_owed(0, 0, 1000 * USDC).unwrap(), 0);
        assert_eq!(position_funding_owed(500, 500, 1000 * USDC).unwrap(), 0);
        assert_eq!(position_funding_owed(500, 500, -1000 * USDC).unwrap(), 0);
    }

    #[test]
    fn long_pays_when_accumulator_rose_above_snapshot() {
        // mark > index for an hour at the cap (10 bps × 100 = 1000 scaled units).
        // 1000 USDC notional long owes 1000 USDC × 1000 / 1e6 = 1 USDC.
        let owed = position_funding_owed(1_000, 0, 1000 * USDC).unwrap();
        assert_eq!(owed, USDC as i128);
    }

    #[test]
    fn short_receives_when_accumulator_rose_above_snapshot() {
        // Same accrual, short side: signed-size flips the result.
        let owed = position_funding_owed(1_000, 0, -1000 * USDC).unwrap();
        assert_eq!(owed, -(USDC as i128));
    }

    #[test]
    fn long_receives_when_accumulator_fell_below_snapshot() {
        // mark < index → cumulative shrinks → long is owed.
        let owed = position_funding_owed(-1_000, 0, 1000 * USDC).unwrap();
        assert_eq!(owed, -(USDC as i128));
    }

    #[test]
    fn proportional_to_size() {
        let small = position_funding_owed(1_000, 0, 100 * USDC).unwrap();
        let big = position_funding_owed(1_000, 0, 10_000 * USDC).unwrap();
        assert_eq!(big, small * 100);
    }
}
