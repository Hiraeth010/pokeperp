import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { PerpEngine } from "../target/types/perp_engine";

describe("perp-engine", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PerpEngine as Program<PerpEngine>;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market")],
    program.programId
  );
  const [insuranceFundPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_fund")],
    program.programId
  );
  const [insuranceVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_vault")],
    program.programId
  );

  let usdcMint: PublicKey;
  // Fake oracle IndexState pubkey — the perp engine doesn't validate this at init time.
  const oracleIndexState = Keypair.generate().publicKey;
  const mintAuthority = Keypair.generate();

  before(async () => {
    usdcMint = await createMint(
      provider.connection,
      payer,
      mintAuthority.publicKey,
      null,
      6
    );
  });

  it("initializes the insurance fund and vault", async () => {
    // Spec: docs/perp-engine.md §7. Split from initialize_market to keep `try_accounts`
    // under Solana's 4KB stack cap (was 104 bytes over before split).
    await program.methods
      .initializeInsuranceFund()
      .accounts({
        insuranceFund: insuranceFundPda,
        insuranceVault: insuranceVaultPda,
        usdcMint,
        admin: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const fund = await program.account.insuranceFund.fetch(insuranceFundPda);
    expect(fund.vault.toBase58()).to.equal(insuranceVaultPda.toBase58());
    expect(fund.floor.toString()).to.equal("25000000000"); // 25k USDC
    expect(fund.totalDeposited.toString()).to.equal("0");
    expect(fund.totalPaidOut.toString()).to.equal("0");

    const vaultAccount = await getAccount(
      provider.connection,
      insuranceVaultPda
    );
    expect(vaultAccount.amount.toString()).to.equal("0");
    expect(vaultAccount.mint.toBase58()).to.equal(usdcMint.toBase58());
    expect(vaultAccount.owner.toBase58()).to.equal(insuranceFundPda.toBase58());
  });

  it("initializes market with phase-0 params", async () => {
    // Spec: docs/perp-engine.md §11 — 3× leverage (33% IM / 16.5% MM), 50k per-trader, 500k OI cap.
    // Market.insurance_fund is set to the deterministic InsuranceFund PDA regardless of whether
    // initialize_insurance_fund has been called yet.
    await program.methods
      .initializeMarket({
        oracleIndexState,
        usdcMint,
        insuranceVault: insuranceVaultPda,
        slippageFactor: 100_000, // 0.10 ×1e6
        oiFloor: new anchor.BN(100_000_000_000), // 100k USDC (micro-USDC)
        initialMarginBps: 3300, // 33%
        maintenanceMarginBps: 1650, // 16.5%
        fundingCapPerHourBps: 10, // 0.10%
        takerFeeBps: 10, // 0.10%
        liquidationPenaltyBps: 150, // 1.50%
        maxOiPerSide: new anchor.BN(500_000_000_000), // 500k USDC
        maxPositionPerTrader: new anchor.BN(50_000_000_000), // 50k USDC
      })
      .accounts({
        market: marketPda,
        usdcMint,
        admin: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const market = await program.account.market.fetch(marketPda);
    expect(market.admin.toBase58()).to.equal(
      provider.wallet.publicKey.toBase58()
    );
    expect(market.oracleIndexState.toBase58()).to.equal(
      oracleIndexState.toBase58()
    );
    expect(market.usdcMint.toBase58()).to.equal(usdcMint.toBase58());
    expect(market.insuranceFund.toBase58()).to.equal(insuranceFundPda.toBase58());
    expect(market.phase).to.equal(0);
    expect(market.slippageFactor).to.equal(100_000);
    expect(market.oiFloor.toString()).to.equal("100000000000");
    expect(market.longOi.toString()).to.equal("0");
    expect(market.shortOi.toString()).to.equal("0");
    expect(market.initialMarginBps).to.equal(3300);
    expect(market.maintenanceMarginBps).to.equal(1650);
    expect(market.fundingCapPerHourBps).to.equal(10);
    expect(market.takerFeeBps).to.equal(10);
    expect(market.liquidationPenaltyBps).to.equal(150);
    expect(market.tradingPaused).to.equal(false);
    expect(market.fundingPaused).to.equal(false);
  });

  it("opens a long position with correct mark price", async () => {
    // Spec: perp-engine.md §3 — mark = index × (1 + slippage_factor × imbalance).
    //
    // BLOCKED ON: full oracle setup wired into perp tests so IndexState exists.
    // This test will:
    //   1. Initialize oracle + register publishers + submit ≥3 PriceUpdates + aggregate_day → IndexState
    //   2. Create trader USDC account, fund with margin + fee
    //   3. Derive Position PDA, MarginVault PDA
    //   4. Call openPosition({ size: 10_000_000_000 /* 10k long */, margin: 3_333_000_000 /* 33% IM */ })
    //   5. Assert: position.size > 0, margin_vault.amount = margin, market.long_oi increased,
    //      insurance_vault.amount = taker_fee (10 bps of size = 10_000_000), mark_price > index_price.
  });

  it("closes a position and pays out margin + PnL", async () => {
    // Spec: perp-engine.md §3 (close at mark price), §5 (margin payout).
    //
    // BLOCKED ON: open_position must run first.
    // This test will:
    //   1. After open_position, advance oracle (re-aggregate with shifted prices to produce PnL)
    //   2. Call closePosition()
    //   3. Assert: payout = initial_margin + signed_pnl (≥ 0); trader USDC balance increased;
    //      margin_vault closed (lamports = 0); position account closed (Anchor close=trader);
    //      market.long_oi decreased back to 0.
    //   4. Negative case: position underwater (mark moved so PnL + margin < 0) should revert
    //      with InsufficientMargin — those positions belong on the liquidation path.
  });

  it("rejects position exceeding per-trader cap", async () => {
    // TODO: perp-engine.md §9.
  });

  it("rejects trade that would breach OI cap", async () => {
    // TODO: perp-engine.md §9.
  });

  it("accrues hourly funding to long when mark > index", async () => {
    // TODO: perp-engine.md §4.
  });

  it("settles funding on position interaction (lazy)", async () => {
    // TODO: perp-engine.md §4.
  });

  it("liquidates position below maintenance margin", async () => {
    // TODO: perp-engine.md §6.
  });

  it("uses min(final_index, mark_twap_5min) as long liquidation reference", async () => {
    // TODO: perp-engine.md §6.
  });

  it("pauses trading when mark deviates >5% from index for >30 minutes", async () => {
    // TODO: perp-engine.md §10.
  });

  it("ADLs the most profitable opposite-side position when insurance below floor", async () => {
    // TODO: perp-engine.md §8.
  });

  it("withdraws margin only when post-withdrawal equity ≥ IM", async () => {
    // TODO: perp-engine.md §5.
  });

  it("transitions from phase 1 to phase 2 via set_phase", async () => {
    // TODO: perp-engine.md §11.
  });
});
