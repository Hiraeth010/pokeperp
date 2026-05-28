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

---

## ACTUAL MAINNET STATE (as deployed)

Programs and the full on-chain skeleton are LIVE on mainnet-beta; the market is
PAUSED (`trading_paused = true`) with an empty insurance fund. Single-operator
oracle. Real Circle USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`).

| Thing | Address |
|---|---|
| oracle program | `GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i` |
| perp program | `Gtpv6K9Fi3pkYcYZEzqaS8DW2nqDwpwPf24Q1WxsQzsa` |
| Config | `CaueezXmytm6ymDC7AGJ3nXUfrwoMiirVvAMuNrhRW6k` |
| Registry | `7dQTC5J3P5Tj1hMLFt21qjRNW5UZH5DbVLsUT5wcthSU` |
| IndexState | `6mxWms4Mv2EZDebJaRJywccnRyXcBPqf7s5gSNPa1ME5` |
| insurance vault | `j5iEeCPzzbCkgkGHYzDj3brKM6b8jBXGDEELseXt5q8` |
| treasury vault | `3ZKwmKQqAJbvvaD7EBvgHhaN5RfHWoSSB9b2uEV9BQew` |
| deploy/admin wallet (current admin + upgrade auth) | `6kDZoNSKfjXwYPLiSnBWNWwNkZCkJ2d4yLYu49BrHYGR` |
| Squad multisig / vault (future admin) | `G88e9ifWs1mmP5XWxxAChVG1qj5CnXppEYsrYuqm2Fmb` / `B5JuVLs4D7ZPoDhW1tUyMeQEyp2KgofsA6HFwTWnqgZC` |
| publisher (registered, 100 USDC bond) | `FRmRRxc46eL2bHg3WJfNCaPWXKgZRkn9iJGbPDGxEStx` |
| keeper | `6ogw5yJz5fQCcAHaCGaro2iqd7iqEdVcf4uuCKmzTKuA` |

Done: programs deployed, state initialized, publisher registered, crank LIVE on
mainnet (Railway `publisher-crank`), scraper hardened (no-render + retries),
Squad created. Keys in `mainnet-keys/` (gitignored). RPC in `mainnet-keys/rpc.url`.

## Parcel B — go-live command sequence (run when the 10k insurance USDC lands)

Pre-req gate: confirm at least one daily crank cycle landed **25/25 real scraped
prices** (`scripts/status-mainnet.ts`) before enabling trading.

1. **Fund:** send 10,000 USDC → `6kDZ…` (admin wallet); send ~1 SOL → keeper `6ogw5…`.
2. **Seed insurance:** `RPC_URL=<mainnet> AMOUNT_USDC=10000 npx tsx scripts/deposit-insurance-mainnet.ts`
3. **Keeper → mainnet (Railway `keeper`):** set `RPC_URL`=mainnet + `KEEPER_KEYPAIR_JSON`=`mainnet-keys/keeper.json`; `railway up --service keeper`.
4. **Indexer → mainnet (Railway `pokeperp-indexer`):** set `RPC_URL`=mainnet; `railway up`.
5. **Monitor → mainnet** (AFTER 2–3 so checks are green): set `RPC_URL`=mainnet + `KEEPER_PUBKEY`=`6ogw5…`; `railway up --service monitor`. Confirm Telegram alerts fire.
6. **Dashboard cutover (Vercel `pokeperp`)** — env flips only, no code change: `RPC_URL`=mainnet Helius (proxy upstream), `NEXT_PUBLIC_RPC_WS`=mainnet WS, `NEXT_PUBLIC_NETWORK`=`mainnet` (hides the devnet banner), `INDEXER_URL`=mainnet indexer. Redeploy (push or `vercel redeploy`).
7. **Enable trading:** `RPC_URL=<mainnet> PAUSE=false npx tsx scripts/set-pause-mainnet.ts`. Verify a small test open/close.
8. **Lock down admin → Squad:** `RPC_URL=<mainnet> npx tsx scripts/squads/migrate-admin-mainnet.ts` (Config.admin + Market.admin → vault `B5Ju…`). After this, set_pause etc. go through the 2-of-3.
9. **(Post-validation) move upgrade authority to the Squad:** `solana program set-upgrade-authority <id> --new-upgrade-authority B5Ju… --upgrade-authority mainnet-keys/deploy.json` for both programs. Deferred from launch so patches stay easy while unaudited.
10. Monitor green across all checks → announce.
