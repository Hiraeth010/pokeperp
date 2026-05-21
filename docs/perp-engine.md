# Perp Engine Design

**Version:** 0.1
**Status:** Draft
**Last updated:** 2026-05-19
**Depends on:** [methodology.md](./methodology.md), [oracle.md](./oracle.md)

The Pokeperp perp engine is the trading layer that settles perpetual futures against the PSA 10 Modern Top 25 index. This document specifies the matching mechanism, margin and leverage rules, funding rate, liquidation engine, insurance fund, and circuit breakers.

---

## 1. Design goals & non-goals

### Goals

- Always-on trading against an index that only updates daily.
- Tolerate the underlying being structurally illiquid (no real spot market to arb against).
- Bound the protocol's tail risk: a single oracle anomaly or whale liquidation should not insolve the system.
- Predictable, transparent funding mechanics so traders can model carry costs in advance.

### Non-goals (v1)

- Sub-second price discovery (the oracle is daily; perp can't be tighter than the underlying allows).
- Cross-margin across multiple perps (only one perp market exists in v1).
- Limit orders, stop-losses, conditional orders — pure market-order vAMM only.
- Maker rebates / professional MM program.

## 2. Architecture overview

```
                   ┌──────────────────────┐
                   │   Oracle program     │
                   │  (final daily index) │
                   └──────────┬───────────┘
                              │ index_price_t
                              ▼
   ┌─────────────┐    ┌──────────────────┐    ┌──────────────┐
   │   Trader    │───▶│   Perp engine    │◀───│  Insurance   │
   │             │    │  (oracle-anchored│    │   fund vault │
   │             │◀───│       vAMM)      │───▶│              │
   └─────────────┘    └────────┬─────────┘    └──────────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │  Margin vaults   │
                      │ (per-position    │
                      │  isolated USDC)  │
                      └──────────────────┘
```

- Single perp market: **PMT25-PERP** quoted in USDC.
- One Solana program owns the matching state, margin vaults, and liquidation flow.
- Oracle program is a separate program; perp engine reads its `IndexState` account.

## 3. Mark price & slippage formula

### Oracle-anchored vAMM

Pokeperp does not use `x * y = k` virtual reserves. Instead, mark price is derived directly from the oracle index plus a deterministic skew term:

```
mark_price = index_price × (1 + slippage_factor × imbalance)

imbalance = (long_OI - short_OI) / max(long_OI + short_OI, OI_FLOOR)
```

Parameters:

| Parameter | Phase 1 | Phase 2 | Notes |
|---|---|---|---|
| `slippage_factor` | 0.10 | 0.05 | Max mark-vs-index skew when fully one-sided |
| `OI_FLOOR` | 100,000 USDC | 100,000 USDC | Prevents divide-by-zero, dampens skew during low-OI bootstrap |

### Why oracle-anchored vAMM and not `x*y=k` or orderbook

- **vs. `x*y=k`**: Constant-product gives implicit slippage and capital-efficiency curves that don't fit a daily-updated index. With explicit `slippage_factor × imbalance`, the protocol controls the depth directly without needing to manage virtual reserves through every oracle push.
- **vs. orderbook**: An orderbook requires market makers from day one. The PMT25 underlying has no professional MM ecosystem — the protocol would be running an empty book. Orderbook deferred to v2 once organic flow exists.

### Trade execution

Every trade is a market order. Given a desired position size `Δ` (positive = long, negative = short):

1. Compute pre-trade `imbalance` and pre-trade `mark_price`.
2. Compute post-trade `imbalance` assuming `Δ` fills.
3. Execution price = average of pre- and post-trade mark prices (linear approximation, exact for the slippage formula above).
4. Charge taker fee (§9), debit margin, update OI counters, mint position account.

## 4. Funding rate

### Mechanic

Funding is paid hourly between long and short position holders. Protocol takes 0% — pure passthrough.

```
funding_rate_hourly = clamp(
    (mark_twap_1h - index_price_final) / index_price_final,
    -funding_cap,
    +funding_cap
)
```

Where:
- `mark_twap_1h` = 1-hour time-weighted average of mark price over the prior hour.
- `index_price_final` = most recent finalized daily index (from oracle, 1+ hour old).
- Longs pay shorts when positive, shorts pay longs when negative.

| Parameter | Phase 1 | Phase 2 |
|---|---|---|
| `funding_cap` (per hour) | ±0.10% | ±0.50% |

### Why this works given a daily oracle

The mark price moves continuously (via trader flow against the vAMM), but the index updates only once per day. Funding rate captures the spread between mark and the last known fair price — if traders push mark too far above index, funding goes positive, longs pay carry, shorts get paid to take the other side. The system is self-balancing as long as the funding cap is large enough to compensate for the index's staleness but small enough not to be punitive.

### Edge cases

- **Index stale (oracle fallback)**: funding accrues at 50% rate until fresh index arrives.
- **Index frozen (eBay outage)**: funding paused entirely. Mark price still floats, but no carry charges accrue.
- **Mark price >5% from index for >30 minutes**: see §10.

## 5. Margin & leverage

### Margin model: isolated, per-position

Each user position has its own margin vault (a PDA owned by the perp program, holding USDC). Positions do not share margin. v1 simplicity > capital efficiency.

### Margin requirements

| Phase | Initial Margin (IM) | Maintenance Margin (MM) | Max Leverage |
|---|---|---|---|
| Phase 1 | 33% | 16.5% | 3× |
| Phase 2 | 20% | 10% | 5× |

`IM` = collateral required to open a position of size `S` is `S × IM%`.
`MM` = position becomes liquidatable when `equity < S × MM%`.

Liquidation threshold is **half of initial margin**, giving traders a ~50% adverse move before liquidation at max leverage.

### Adding / removing margin

Users can deposit additional USDC into an open position's margin vault (reduces effective leverage). Withdrawals allowed up to the point that would not breach `IM`.

## 6. Liquidation engine

### Trigger

A position is liquidatable when:

```
equity(position) < position_size × MM%
```

Where `equity = margin_deposit + unrealized_pnl` and `unrealized_pnl` is computed using the **liquidation reference price**:

```
liq_ref_price = for longs:  min(index_price_final, mark_twap_5min)
                for shorts: max(index_price_final, mark_twap_5min)
```

This gives the liquidatee benefit of the doubt — a single bad mark spike does not trigger liquidation if the most recent final index is still in their favor, and a stale index can't liquidate them if mark has moved against them but the index will confirm at next push.

### Execution

1. Any account can call `liquidate(position)` if `equity < S × MM%`.
2. Position closed at `liq_ref_price`.
3. Penalty: 1.5% of position notional.
   - 0.5% → liquidator (incentive).
   - 1.0% → insurance fund.
4. Remaining margin (after closing PnL and penalty) returned to trader.

### Partial liquidations

If `equity` is still positive after closing, the trader keeps the remainder. Partial liquidations (closing only enough to bring back to IM) are deferred to v2; v1 closes the full position to keep the engine simple.

## 7. Insurance fund

### Capitalization

- Bootstrap: 100,000 USDC from protocol treasury at launch.
- Ongoing: 1.0% of every liquidation (per §6) + 10% of all taker fees collected.

### Use

- Pays liquidation shortfalls when a liquidated position has negative equity at close (closing PnL > remaining margin).
- Covers oracle-failure events (e.g., post-mortem socialized losses if the index later proves to have been wrong).
- Funds ADL events only after fund balance falls below a threshold (see §8).

### Withdrawals from insurance fund

Only via governance (core multisig + super-majority of publishers). No automated drain.

## 8. Auto-Deleveraging (ADL)

When the insurance fund balance falls below `INSURANCE_FLOOR` (initially 25,000 USDC) and a liquidatable position still has negative equity that cannot be covered:

1. Find the most profitable position on the opposite side, ranked by `unrealized_pnl / position_margin`.
2. Close it at the current mark price, no penalty to the ADL'd trader.
3. ADL'd trader's PnL is realized as normal; they just lose the position.

ADL is a last-resort backstop. The phase-1 OI caps (§9) are sized to make ADL extremely unlikely.

## 9. Position limits, OI caps, fees

### Position & OI caps

| Phase | Max position per trader | Max aggregate OI (per side) |
|---|---|---|
| Phase 1 | 50,000 USDC notional | 500,000 USDC |
| Phase 2 | 250,000 USDC notional | 5,000,000 USDC |
| Phase 3+ | Scales with insurance fund (governance) | Scales with insurance fund |

OI caps are per-side (long and short tracked separately) and enforced at trade time. Trades that would breach the cap revert.

### Fees

| Fee | Rate | Destination |
|---|---|---|
| Taker fee | 10 bps (0.10%) | 90% protocol treasury, 10% insurance fund |
| Maker fee | n/a in v1 (no orderbook) | — |
| Funding | passthrough | trader-to-trader, 0% protocol take |
| Liquidation penalty | 150 bps (1.50%) | 0.5% liquidator, 1.0% insurance fund |

## 10. Circuit breakers

Extending oracle-side circuit breakers (oracle spec §9):

| Condition | Response |
|---|---|
| `mark_price` deviates >5% from `index_price_final` for >30 minutes | Pause new trades; allow position-close-only mode for 1 hour |
| Oracle reports stale index (oracle spec §9) | Funding rate halved; trading continues |
| Oracle reports eBay outage | Funding paused; trading continues with 2× margin requirements |
| Oracle emergency pause | Perp engine pauses all trading and liquidations |
| Insurance fund < `INSURANCE_FLOOR` and ADL queue non-empty | OI caps halved automatically until fund recapitalized |

## 11. Phased rollout (aligned with oracle phases)

### Phase 0 (oracle shadow): no perp activity

- Perp program deployed, not initialized for trading.

### Phase 1 (days 31–90): conservative launch

- 3× leverage, 33% IM.
- 50k per-trader, 500k aggregate OI.
- 0.10%/hr funding cap.
- Daily monitoring of mark-vs-index spread.

### Phase 2 (days 91+): scaled launch

- 5× leverage, 20% IM.
- 250k per-trader, 5M aggregate OI.
- 0.50%/hr funding cap.
- Slippage factor reduced from 0.10 → 0.05 (assumes deeper OI).

### Phase 3 (governance-gated): mature operation

- Orderbook layer added on top of vAMM (Drift v2-style).
- Cross-margin across PMT25-PERP and any future markets.
- Limit / stop / TWAP order types.
- Out of scope for v1 documentation.

## 12. Open questions for v0.2

- **Funding interval**: hourly chosen for simplicity. Continuous accrual (per-slot) would be more accurate but adds compute overhead. Pyth perps and Drift use hourly or 8-hour intervals — hourly is the right balance for v1.
- **Mark price TWAP window**: 1-hour for funding, 5-minute for liquidation reference. Both somewhat arbitrary; should validate against simulation once historical data exists.
- **Slippage factor calibration**: 0.10 (phase 1) is a guess. Should be tuned against simulated flow scenarios before mainnet launch.
- **Insurance fund seeding**: 100k USDC may be insufficient if OI scales fast. Consider tying floor to a fraction of aggregate OI (e.g., insurance ≥ 5% of OI) as a governance-adjustable parameter.
- **Cross-margin in v2**: only meaningful if a second market (e.g., a Vintage 25 index) launches. Defer until then.
- **Permissionless liquidators**: anyone can liquidate today (no whitelist). Should we add a Dutch-auction or batch-auction mechanism to prevent liquidator MEV? Probably yes for v2.
