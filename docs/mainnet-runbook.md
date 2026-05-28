# Mainnet runbook (internal)

> **Internal ops doc — not published on the site.** This is the turnkey checklist
> for moving Pokeperp from the live devnet deployment to mainnet-beta with real
> user funds. Work top to bottom; nothing here should be improvised on launch day.

## 0. Decisions / accepted risks (consciously deferred)

These were reviewed and **explicitly deferred** by the operator — documented here
so the risk posture is on the record, not an oversight:

- **No third-party security audit** of the on-chain programs. The perp engine
  custodies user collateral and runs complex settlement (funding, PnL,
  liquidation, ADL, insurance shortfall). Shipping unaudited = accepted risk.
- **No formal legal/regulatory review** of a leveraged perpetual on a novel
  underlying for (potentially US) users, nor of using PSA-10 card prices as the
  settlement index.
- **Oracle remains operator-run** (effectively one publisher/crank operator
  today) rather than a decentralized federation of independent publishers; thin
  PSA-10 markets are manipulable. Accepted for launch.

Revisit before scaling TVL.

## 1. Capital sizing (#6) — you provide real funds

| Use | Amount (USDC/SOL) | Where |
|---|---|---|
| Insurance fund seed | 25k–100k USDC (Phase 1); 250k+ for Phase 2 | `deposit_insurance` |
| Publisher bonds | 10k USDC × N publishers | escrowed at `register_publisher` |
| Keeper wallet | ~1–2 SOL (liquidation/funding tx fees) | keeper key |
| Publisher-crank wallet | ~0.5–1 SOL (daily submit+aggregate fees) | publisher key |
| Program deploys | ~5–8 SOL (two upgradeable programs) | deploy wallet |
| Multisig + setup | ~0.1 SOL | Squad creation |

Real USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.

## 2. Pre-deploy

- [ ] Fresh keys for every role (publisher, keeper, admin signers). **Never** reuse
      devnet keys — they're in this repo's git history. See `docs/secrets.md`.
- [ ] Build SBF artifacts with `anchor build` (not a bare `cargo-build-sbf`).
- [ ] Decide program IDs: reuse the existing keypairs (same IDs as devnet) or
      generate fresh. If fresh, update `Anchor.toml` + every hardcoded ID
      (dashboard `lib/anchor.ts`, keeper/monitor/indexer `src`, scraper config).
- [ ] Confirm `cargo test` (unit) + `anchor test` (localnet integration) green.

## 3. Deploy programs (#10)

```sh
solana program deploy --url mainnet-beta \
  --program-id target/deploy/oracle-keypair.json target/deploy/oracle.so
solana program deploy --url mainnet-beta \
  --program-id target/deploy/perp_engine-keypair.json target/deploy/perp_engine.so
```

- [ ] Verify both executable on mainnet.
- [ ] `solana program show <id>` — confirm upgrade authority (set to multisig in §6).

## 4. Initialize on-chain state

- [ ] Oracle `initialize` with the **production** Config: `submissionWindowStart/End`
      = **20:00–23:59 UTC** (not the dev full-day window), `minPublishersPerDay` ≥ 3,
      real bond/challenge-bond amounts, challenge window per spec.
- [ ] Registry: `initialize_registry` + 25× `update_constituent` + `finalize_registry_update`
      with the real PMT25 inception list, wired to real USDC.
- [ ] Perp `initialize_market` + `initialize_insurance_fund` + `initialize_treasury`,
      `usdc_mint` = real USDC, Phase-1 risk params.
- [ ] `set_protocol_treasury` to wire the perp treasury into oracle Config.
- [ ] `deposit_insurance` with the seed from §1.
- [ ] Register N publishers + escrow bonds.

## 5. Off-chain services (point at mainnet)

- [ ] publisher-crank, keeper, monitor, indexer: set `RPC_URL`/`RPC_WS` to a
      mainnet Helius endpoint; inject mainnet keys as Railway secrets.
- [ ] Dashboard (Vercel): set the server-side `RPC_URL` (proxy) to mainnet Helius;
      set `INDEXER_URL`; **finish the Root Directory = `services/dashboard`** setting
      so git auto-deploy builds correctly.
- [ ] Remove the devnet warning banner (`components/DevnetBanner.tsx`) + any
      "devnet" copy; update wsEndpoint default to mainnet.
- [ ] Monitor thresholds reviewed for mainnet cadence; confirm Telegram alerts fire.

## 6. Admin → Squads multisig (independent custody)

- [ ] Create a **mainnet** Squad with **independently-custodied** signers
      (hardware wallets / separate people) — NOT three keys on one machine like the
      devnet practice run. Scripts: `services/dashboard/scripts/squads/`.
- [ ] `propose_admin_transfer(vault)` + `accept_admin_transfer()` (via Squad) on
      **both** oracle Config and perp Market.
- [ ] Set each program's **upgrade authority** to the Squad too.
- [ ] Verify `Config.admin` and `Market.admin` == Squad vault.

## 7. Phase 0 shadow (#8) — ~30 days

- [ ] Leave the market un-traded (or keep `set_pause`/Phase 0) while the index
      runs daily. The crank submits + aggregates; monitor confirms freshness.
- [ ] Validate the index against reality (eBay sold prints) over the window; tune
      the methodology / publisher source if it drifts.
- [ ] Only after the shadow window: `set_phase(1)` to enable Phase-1 trading
      (3× leverage, 50k/trader, 500k OI). Phase 2 later (5×, 250k) per spec.

## 8. Go-live

- [ ] Risk disclosures + Terms of Service published; liquidation/funding explainers
      in the dashboard docs.
- [ ] Monitor green across all checks; keeper funded; insurance at target.
- [ ] Announce.
