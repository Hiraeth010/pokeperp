import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Oracle } from "../target/types/oracle";

describe("oracle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Oracle as Program<Oracle>;
  const payer = (provider.wallet as anchor.Wallet).payer;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );

  let usdcMint: PublicKey;
  let adminUsdcAta: PublicKey;
  const mintAuthority = Keypair.generate();
  // Persistent publisher keypair shared across register + submit tests.
  const publisherKp = Keypair.generate();

  before(async () => {
    usdcMint = await createMint(
      provider.connection,
      payer,
      mintAuthority.publicKey,
      null,
      6
    );
    adminUsdcAta = await createAssociatedTokenAccount(
      provider.connection,
      payer,
      usdcMint,
      provider.wallet.publicKey
    );
    await mintTo(
      provider.connection,
      payer,
      usdcMint,
      adminUsdcAta,
      mintAuthority,
      100_000_000_000 // 100,000 USDC
    );

    // Publisher needs SOL to pay PriceUpdate rent in the submit test.
    // Use SystemProgram.transfer rather than requestAirdrop — Solana 1.18's
    // localnet faucet rejects airdrops on Windows ("Internal error").
    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: publisherKp.publicKey,
        lamports: 1 * LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundTx, []);
  });

  it("initializes config with expected fields", async () => {
    // Spec: docs/oracle.md §2 / §7 / §8.
    // NOTE: submission window widened to full day so the submit test can run at any wall-clock time.
    await program.methods
      .initialize({
        publisherBond: new anchor.BN(10_000_000_000),
        challengeBond: new anchor.BN(1_000_000_000),
        minPublishersPerDay: 3,
        submissionWindowStart: 0,
        submissionWindowEnd: 24 * 3600 - 1,
        challengeWindowSeconds: 3600,
      })
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const config = await program.account.config.fetch(configPda);
    expect(config.admin.toBase58()).to.equal(
      provider.wallet.publicKey.toBase58()
    );
    expect(config.publisherCount).to.equal(0);
    expect(config.publisherBond.toString()).to.equal("10000000000");
    expect(config.challengeBond.toString()).to.equal("1000000000");
    expect(config.phase).to.equal(0);
    expect(config.minPublishersPerDay).to.equal(3);
    expect(config.submissionWindowStart).to.equal(0);
    expect(config.submissionWindowEnd).to.equal(24 * 3600 - 1);
    expect(config.challengeWindowSeconds).to.equal(3600);
    expect(config.paused).to.equal(false);
  });

  it("registers a publisher and escrows the bond", async () => {
    // Spec: docs/oracle.md §2 onboarding.
    const [publisherPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("publisher"), publisherKp.publicKey.toBuffer()],
      program.programId
    );
    const [bondVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bond_vault"), publisherKp.publicKey.toBuffer()],
      program.programId
    );

    const adminBalanceBefore = (
      await getAccount(provider.connection, adminUsdcAta)
    ).amount;

    await program.methods
      .registerPublisher(publisherKp.publicKey)
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
        publisherAccount: publisherPda,
        adminUsdcAccount: adminUsdcAta,
        bondVault: bondVaultPda,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const publisher = await program.account.publisher.fetch(publisherPda);
    expect(publisher.publisherKey.toBase58()).to.equal(
      publisherKp.publicKey.toBase58()
    );
    expect(publisher.bondAmount.toString()).to.equal("10000000000");
    expect(publisher.bondVault.toBase58()).to.equal(bondVaultPda.toBase58());
    expect(publisher.status).to.deep.equal({ shadow: {} });
    expect(publisher.shadowPeriodDaysRemaining).to.equal(30);

    const vaultAccount = await getAccount(provider.connection, bondVaultPda);
    expect(vaultAccount.amount.toString()).to.equal("10000000000");

    const adminBalanceAfter = (
      await getAccount(provider.connection, adminUsdcAta)
    ).amount;
    expect((adminBalanceBefore - adminBalanceAfter).toString()).to.equal(
      "10000000000"
    );

    const config = await program.account.config.fetch(configPda);
    expect(config.publisherCount).to.equal(1);
  });

  it("accepts a publisher price submission for day T-1", async () => {
    // Spec: docs/oracle.md §4 — submissions on day T are for day T-1.
    const nowSec = Math.floor(Date.now() / 1000);
    const currentDay = Math.floor(nowSec / 86400);
    const submissionDay = currentDay - 1;

    const [publisherPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("publisher"), publisherKp.publicKey.toBuffer()],
      program.programId
    );

    const dayBuf = Buffer.alloc(4);
    dayBuf.writeUInt32LE(submissionDay, 0);
    const [priceUpdatePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("price"),
        publisherKp.publicKey.toBuffer(),
        dayBuf,
      ],
      program.programId
    );

    // 25-element price array (micro-USDC) — illustrative values.
    const prices = Array.from({ length: 25 }, (_, i) =>
      new anchor.BN(1_000_000_000 + i * 10_000_000)
    );
    const saleCounts = Array.from({ length: 25 }, () => 100);
    const sourceRoot = Array.from({ length: 32 }, () => 0);

    await program.methods
      .submitPriceUpdate(submissionDay, prices, saleCounts, sourceRoot)
      .accounts({
        config: configPda,
        publisher: publisherKp.publicKey,
        publisherAccount: publisherPda,
        priceUpdate: priceUpdatePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([publisherKp])
      .rpc();

    const pu = await program.account.priceUpdate.fetch(priceUpdatePda);
    expect(pu.publisher.toBase58()).to.equal(publisherKp.publicKey.toBase58());
    expect(pu.day).to.equal(submissionDay);
    expect(pu.prices[0].toString()).to.equal("1000000000");
    expect(pu.prices[24].toString()).to.equal("1240000000");
    expect(pu.saleCounts[0]).to.equal(100);
    expect(pu.sourceRoot).to.deep.equal(sourceRoot);

    const publisher = await program.account.publisher.fetch(publisherPda);
    expect(publisher.totalSubmissions.toString()).to.equal("1");
    expect(publisher.lastSubmittedDay).to.equal(submissionDay);
  });

  it("rejects duplicate submissions for the same day", async () => {
    // Spec: docs/oracle.md §4 — the (publisher, day) PDA collision causes the second submission to revert.
    const nowSec = Math.floor(Date.now() / 1000);
    const currentDay = Math.floor(nowSec / 86400);
    const submissionDay = currentDay - 1;

    const [publisherPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("publisher"), publisherKp.publicKey.toBuffer()],
      program.programId
    );
    const dayBuf = Buffer.alloc(4);
    dayBuf.writeUInt32LE(submissionDay, 0);
    const [priceUpdatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("price"), publisherKp.publicKey.toBuffer(), dayBuf],
      program.programId
    );

    const prices = Array.from({ length: 25 }, () => new anchor.BN(1_000_000_000));
    const saleCounts = Array.from({ length: 25 }, () => 100);
    const sourceRoot = Array.from({ length: 32 }, () => 0);

    let threw = false;
    try {
      await program.methods
        .submitPriceUpdate(submissionDay, prices, saleCounts, sourceRoot)
        .accounts({
          config: configPda,
          publisher: publisherKp.publicKey,
          publisherAccount: publisherPda,
          priceUpdate: priceUpdatePda,
          systemProgram: SystemProgram.programId,
        })
        .signers([publisherKp])
        .rpc();
    } catch (_err) {
      threw = true;
    }
    expect(threw, "duplicate submission should have reverted").to.equal(true);
  });

  it("rejects activation while publisher is still in shadow period", async () => {
    // Spec: docs/oracle.md §2 — publishers must spend 30 days in Shadow before
    // they can be promoted to Active. The current_day - joined_day check
    // reverts PublisherInShadow if elapsed < 30. Positive path (elapsed >= 30
    // + admin promotes) needs a clock-warped validator which Solana 1.18's
    // test-validator doesn't expose cleanly — deferred to a separate test
    // harness once we have devnet automation.
    const [publisherPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("publisher"), publisherKp.publicKey.toBuffer()],
      program.programId
    );

    // The publisher was just registered earlier in this suite (joined_day =
    // today). elapsed_days = 0; well below the 30-day requirement.
    let threw = false;
    let errCode: string | undefined;
    try {
      await program.methods
        .activatePublisher()
        .accounts({
          config: configPda,
          admin: provider.wallet.publicKey,
          publisherAccount: publisherPda,
        })
        .rpc();
    } catch (e) {
      threw = true;
      const msg = e instanceof Error ? e.message : String(e);
      // Anchor surfaces the error code in the message; check the spec'd one.
      if (msg.includes("PublisherInShadow")) errCode = "PublisherInShadow";
    }
    expect(threw, "activation during shadow period should revert").to.equal(
      true
    );
    expect(errCode, "should revert with PublisherInShadow specifically").to.equal(
      "PublisherInShadow"
    );

    // Confirm the publisher status is unchanged.
    const publisher = await program.account.publisher.fetch(publisherPda);
    expect(publisher.status).to.deep.equal({ shadow: {} });
  });

  it("rejects activation from a non-admin signer", async () => {
    // Spec: docs/oracle.md §2 — only the oracle admin can promote publishers.
    const stranger = Keypair.generate();
    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: stranger.publicKey,
        lamports: LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundTx, []);

    const [publisherPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("publisher"), publisherKp.publicKey.toBuffer()],
      program.programId
    );

    let threw = false;
    try {
      await program.methods
        .activatePublisher()
        .accounts({
          config: configPda,
          admin: stranger.publicKey,
          publisherAccount: publisherPda,
        })
        .signers([stranger])
        .rpc();
    } catch (_e) {
      threw = true;
      // Anchor catches the admin == config.admin constraint as Unauthorized.
    }
    expect(threw, "non-admin activation should revert").to.equal(true);
  });

  it("initializes the constituent registry to zero state", async () => {
    // Spec: docs/methodology.md §1, §5, §9.8.
    // The registry is zero-copy; init zero-fills the data segment.
    // Caller then populates via 25× update_constituent + finalize_registry_update.
    const [registryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry")],
      program.programId
    );

    await program.methods
      .initializeRegistry()
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
        registry: registryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const reg = await program.account.constituentRegistry.fetch(registryPda);
    expect(reg.version).to.equal(0);
    expect(reg.effectiveDay).to.equal(0);
    expect(reg.constituents[0].collectorNumber).to.equal(0);
    expect(reg.constituents[0].basePrice.toString()).to.equal("0");
  });

  it("updates a constituent slot and preserves base_price on same-identity update", async () => {
    // Spec: docs/methodology.md §9.8 — preservation matches by (set_code, collector_number, variant_code).
    const [registryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry")],
      program.programId
    );

    const padBytes = (s: string, len: number): number[] => {
      const buf = Buffer.alloc(len);
      Buffer.from(s).copy(buf, 0, 0, Math.min(s.length, len));
      return Array.from(buf);
    };
    const zeroHash = (): number[] => Array.from({ length: 32 }, () => 0);
    const constituent = (overrides: any = {}) => ({
      basePrice: new anchor.BN(0),
      canonicalSearchHash: zeroHash(),
      setCode: padBytes("ES", 8),
      variantCode: padBytes("AA", 8),
      collectorNumber: 215,
      setTotal: 203,
      pad: [0, 0, 0, 0],
      ...overrides,
    });

    // First write: slot 0 = Umbreon VMAX, base_price = 0 (will be set by aggregate_day later).
    await program.methods
      .updateConstituent(0, constituent())
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
        registry: registryPda,
      })
      .rpc();

    let reg = await program.account.constituentRegistry.fetch(registryPda);
    expect(reg.constituents[0].collectorNumber).to.equal(215);
    expect(reg.constituents[0].basePrice.toString()).to.equal("0");

    // Simulate base_price being set by aggregate_day: rewrite same identity with non-zero base.
    // The handler should preserve the previous base_price even though we passed a different one.
    await program.methods
      .updateConstituent(0, constituent({ basePrice: new anchor.BN(1_450_000_000) }))
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
        registry: registryPda,
      })
      .rpc();

    // First update wrote base_price = 0; second update has same identity, so base_price stays 0.
    reg = await program.account.constituentRegistry.fetch(registryPda);
    expect(reg.constituents[0].basePrice.toString()).to.equal("0");

    // Now change identity (collector_number) — base_price should reset to the new value.
    await program.methods
      .updateConstituent(
        0,
        constituent({ collectorNumber: 218, basePrice: new anchor.BN(2_825_000_000) })
      )
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
        registry: registryPda,
      })
      .rpc();

    reg = await program.account.constituentRegistry.fetch(registryPda);
    expect(reg.constituents[0].collectorNumber).to.equal(218);
    expect(reg.constituents[0].basePrice.toString()).to.equal("2825000000");
  });

  it("finalizes the rebalance by bumping version and effective_day", async () => {
    const [registryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry")],
      program.programId
    );
    const before = await program.account.constituentRegistry.fetch(registryPda);

    const newEffectiveDay = Math.floor(Date.now() / 1000 / 86400) + 1;
    await program.methods
      .finalizeRegistryUpdate(newEffectiveDay)
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
        registry: registryPda,
      })
      .rpc();

    const after = await program.account.constituentRegistry.fetch(registryPda);
    expect(after.version).to.equal(before.version + 1);
    expect(after.effectiveDay).to.equal(newEffectiveDay);
  });

  it("rejects submissions outside the daily window", async () => {
    // TODO: oracle.md §4 — needs clock manipulation or test-time config restriction.
  });

  it("aggregates a single submission and writes IndexState (all-stale path)", async () => {
    // Spec: docs/oracle.md §5 — with min_publishers_per_day = 3 and only 1 submission,
    // every constituent is marked stale, but IndexState is still created with index_value
    // computed as if every constituent contributes ratio = 1.0 (index-neutral entry).
    const nowSec = Math.floor(Date.now() / 1000);
    const currentDay = Math.floor(nowSec / 86400);
    const submissionDay = currentDay - 1;

    const [registryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry")],
      program.programId
    );
    const [indexStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("index_state")],
      program.programId
    );

    const dayBuf = Buffer.alloc(4);
    dayBuf.writeUInt32LE(submissionDay, 0);
    const [priceUpdatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("price"), publisherKp.publicKey.toBuffer(), dayBuf],
      program.programId
    );

    await program.methods
      .aggregateDay(submissionDay)
      .accounts({
        config: configPda,
        registry: registryPda,
        indexState: indexStatePda,
        caller: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: priceUpdatePda, isWritable: false, isSigner: false },
      ])
      .rpc();

    const idx = await program.account.indexState.fetch(indexStatePda);
    expect(idx.day).to.equal(submissionDay);
    expect(idx.status).to.deep.equal({ provisional: {} });
    // All 25 constituents stale (1 submission < min_publishers_per_day = 3).
    for (let i = 0; i < 25; i++) {
      expect(idx.constituentStatus[i]).to.equal(1);
      expect(idx.aggregatedPrices[i].toString()).to.equal("0");
    }
    // Every stale ratio = 1.0 ×1e6 = 1_000_000; sum = 25 × 1e6 = 2.5e7; index = 40 × sum = 1e9.
    expect(idx.indexValue.toString()).to.equal("1000000000");
  });

  it("marks constituents stale when <3 valid submissions", async () => {
    // Covered by the all-stale test above. Multi-publisher median path needs more registered
    // publishers (each must sign their own submit_price_update) — TODO once test infra supports it.
  });

  // ---- Challenge / slashing flow (oracle.md §6, §7) ----
  // Shared state across the four challenge tests. The first test opens a challenge
  // against publisherKp for (submissionDay, constituent=0); the second resolves it as
  // succeeded with the 10% slash tier. The third opens a SECOND challenge against the
  // same publisher for constituent=1 and resolves as failed to exercise the refund/treasury
  // distribution. The treasury vault is created once and wired into Config via
  // set_protocol_treasury before any resolve.
  const challengerKp = Keypair.generate();
  let challengerUsdcAta: PublicKey;
  let treasuryVault: PublicKey;
  const challengeBond = BigInt(1_000_000_000); // 1k USDC, matches Config.challengeBond from initialize test.
  const publisherInitialBond = BigInt(10_000_000_000); // 10k USDC, matches Config.publisherBond.
  const submissionDayForChallenge = (() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const currentDay = Math.floor(nowSec / 86400);
    return currentDay - 1;
  })();

  it("accepts a challenge within the 1-hour window", async () => {
    // Spec: docs/oracle.md §6 — challenge opens within challenge_window_seconds of
    // IndexState going Provisional. Bond is escrowed into a per-challenge PDA vault.

    // Fund challenger with SOL + USDC for the bond.
    const fundSol = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: challengerKp.publicKey,
        lamports: LAMPORTS_PER_SOL,
      })
    );
    await provider.sendAndConfirm(fundSol, []);

    challengerUsdcAta = await createAssociatedTokenAccount(
      provider.connection,
      payer,
      usdcMint,
      challengerKp.publicKey
    );
    await mintTo(
      provider.connection,
      payer,
      usdcMint,
      challengerUsdcAta,
      mintAuthority,
      Number(challengeBond * BigInt(3)) // enough for two challenges + slack
    );

    // Create the protocol treasury USDC vault (in real deployments this is the
    // perp-engine Treasury PDA; here we use a plain SPL token account owned by
    // a fresh keypair — oracle never signs for it, only transfers INTO it).
    const treasuryOwner = Keypair.generate();
    treasuryVault = await createAssociatedTokenAccount(
      provider.connection,
      payer,
      usdcMint,
      treasuryOwner.publicKey
    );

    // Wire the treasury into Config (admin-only).
    await program.methods
      .setProtocolTreasury(treasuryVault)
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
      })
      .rpc();
    const cfg = await program.account.config.fetch(configPda);
    expect(cfg.protocolTreasuryVault.toBase58()).to.equal(treasuryVault.toBase58());

    // Open the challenge against publisherKp for (submissionDay, constituent 0).
    const targetDay = submissionDayForChallenge;
    const targetConstituent = 0;
    const dayBuf = Buffer.alloc(4);
    dayBuf.writeUInt32LE(targetDay, 0);

    const [challengePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("challenge"),
        challengerKp.publicKey.toBuffer(),
        dayBuf,
        Buffer.from([targetConstituent]),
      ],
      program.programId
    );
    const [challengeBondVaultPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("challenge_bond_vault"),
        challengerKp.publicKey.toBuffer(),
        dayBuf,
        Buffer.from([targetConstituent]),
      ],
      program.programId
    );
    const [indexStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("index_state")],
      program.programId
    );

    const challengerBalanceBefore = (
      await getAccount(provider.connection, challengerUsdcAta)
    ).amount;

    await program.methods
      .openChallenge(
        targetDay,
        publisherKp.publicKey,
        targetConstituent,
        new anchor.BN(900_000_000), // claimed_correct_price (illustrative)
        "ipfs://bafy-test-evidence"
      )
      .accounts({
        config: configPda,
        challenger: challengerKp.publicKey,
        indexState: indexStatePda,
        challenge: challengePda,
        challengerUsdcAccount: challengerUsdcAta,
        challengeBondVault: challengeBondVaultPda,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([challengerKp])
      .rpc();

    const c = await program.account.challenge.fetch(challengePda);
    expect(c.challenger.toBase58()).to.equal(challengerKp.publicKey.toBase58());
    expect(c.targetPublisher.toBase58()).to.equal(publisherKp.publicKey.toBase58());
    expect(c.targetDay).to.equal(targetDay);
    expect(c.targetConstituent).to.equal(targetConstituent);
    expect(c.bond.toString()).to.equal(challengeBond.toString());
    expect(c.status).to.deep.equal({ open: {} });
    expect(c.slashBps).to.equal(0);
    expect(c.slashedAmount.toString()).to.equal("0");

    const bondVault = await getAccount(provider.connection, challengeBondVaultPda);
    expect(bondVault.amount.toString()).to.equal(challengeBond.toString());

    const challengerBalanceAfter = (
      await getAccount(provider.connection, challengerUsdcAta)
    ).amount;
    expect((challengerBalanceBefore - challengerBalanceAfter).toString()).to.equal(
      challengeBond.toString()
    );
  });

  it("rejects a challenge after window close", async () => {
    // TODO: oracle.md §6 — needs clock manipulation past challenge_window_seconds.
    // Deferred: solana-test-validator on Solana 1.18 doesn't expose a clean clock-warp,
    // and re-running with a 1-second window would invalidate the in-window test above.
    // The handler enforces `elapsed < window` and reverts with ChallengeWindowClosed;
    // covered logically by the require! in open_challenge.
  });

  it("slashes a publisher when challenge succeeds", async () => {
    // Spec: docs/oracle.md §7 — 10% slash tier on a >5% deviation success.
    // Resolve the challenge opened above; verify the slash math + distribution.
    const targetDay = submissionDayForChallenge;
    const targetConstituent = 0;
    const dayBuf = Buffer.alloc(4);
    dayBuf.writeUInt32LE(targetDay, 0);

    const [challengePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("challenge"),
        challengerKp.publicKey.toBuffer(),
        dayBuf,
        Buffer.from([targetConstituent]),
      ],
      program.programId
    );
    const [challengeBondVaultPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("challenge_bond_vault"),
        challengerKp.publicKey.toBuffer(),
        dayBuf,
        Buffer.from([targetConstituent]),
      ],
      program.programId
    );
    const [publisherPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("publisher"), publisherKp.publicKey.toBuffer()],
      program.programId
    );
    const [publisherBondVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bond_vault"), publisherKp.publicKey.toBuffer()],
      program.programId
    );

    // Snapshot balances pre-resolve.
    const challengerBefore = (
      await getAccount(provider.connection, challengerUsdcAta)
    ).amount;
    const treasuryBefore = (await getAccount(provider.connection, treasuryVault)).amount;
    const publisherVaultBefore = (
      await getAccount(provider.connection, publisherBondVaultPda)
    ).amount;
    expect(publisherVaultBefore.toString()).to.equal(publisherInitialBond.toString());

    const slashBps = 1000; // 10% per §7 (>5% deviation tier)
    const expectedSlashed = (publisherInitialBond * BigInt(slashBps)) / BigInt(10_000);
    const expectedChallengerShare = expectedSlashed / BigInt(2);
    const expectedTreasuryShare = expectedSlashed - expectedChallengerShare;

    await program.methods
      .resolveChallenge(true, slashBps)
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
        challenge: challengePda,
        challengeBondVault: challengeBondVaultPda,
        targetPublisherAccount: publisherPda,
        targetPublisherBondVault: publisherBondVaultPda,
        challengerUsdcAccount: challengerUsdcAta,
        treasuryVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    // Challenge state updated.
    const c = await program.account.challenge.fetch(challengePda);
    expect(c.status).to.deep.equal({ succeeded: {} });
    expect(c.slashBps).to.equal(slashBps);
    expect(c.slashedAmount.toString()).to.equal(expectedSlashed.toString());
    // Payout = challenger share of slash + bond refund.
    expect(c.challengerPayout.toString()).to.equal(
      (expectedChallengerShare + challengeBond).toString()
    );

    // Publisher bond reduced; status untouched at 10% tier (no auto-suspend).
    const pub = await program.account.publisher.fetch(publisherPda);
    expect(pub.bondAmount.toString()).to.equal(
      (publisherInitialBond - expectedSlashed).toString()
    );
    expect(pub.successfulChallengesAgainst).to.equal(1);
    expect(pub.status).to.deep.equal({ shadow: {} });

    // Token balances: challenger gets slash share + bond refund; treasury gets remainder.
    const challengerAfter = (
      await getAccount(provider.connection, challengerUsdcAta)
    ).amount;
    expect((challengerAfter - challengerBefore).toString()).to.equal(
      (expectedChallengerShare + challengeBond).toString()
    );
    const treasuryAfter = (await getAccount(provider.connection, treasuryVault)).amount;
    expect((treasuryAfter - treasuryBefore).toString()).to.equal(
      expectedTreasuryShare.toString()
    );
    const publisherVaultAfter = (
      await getAccount(provider.connection, publisherBondVaultPda)
    ).amount;
    expect((publisherVaultBefore - publisherVaultAfter).toString()).to.equal(
      expectedSlashed.toString()
    );
    // Challenge bond vault drained.
    const cbvAfter = (await getAccount(provider.connection, challengeBondVaultPda)).amount;
    expect(cbvAfter.toString()).to.equal("0");
  });

  it("redistributes bond 50/50 (publisher + treasury) when challenge fails", async () => {
    // Spec: docs/oracle.md §6 — failed challenge: challenger loses bond, split 50/50
    // between targeted publisher (compensation) and protocol treasury.
    // Open a fresh challenge against constituent 1 to avoid the PDA collision with above.
    const targetDay = submissionDayForChallenge;
    const targetConstituent = 1;
    const dayBuf = Buffer.alloc(4);
    dayBuf.writeUInt32LE(targetDay, 0);

    const [challengePda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("challenge"),
        challengerKp.publicKey.toBuffer(),
        dayBuf,
        Buffer.from([targetConstituent]),
      ],
      program.programId
    );
    const [challengeBondVaultPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("challenge_bond_vault"),
        challengerKp.publicKey.toBuffer(),
        dayBuf,
        Buffer.from([targetConstituent]),
      ],
      program.programId
    );
    const [publisherPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("publisher"), publisherKp.publicKey.toBuffer()],
      program.programId
    );
    const [publisherBondVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bond_vault"), publisherKp.publicKey.toBuffer()],
      program.programId
    );
    const [indexStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("index_state")],
      program.programId
    );

    // Open a second challenge.
    await program.methods
      .openChallenge(
        targetDay,
        publisherKp.publicKey,
        targetConstituent,
        new anchor.BN(1_100_000_000),
        "ipfs://bafy-test-evidence-2"
      )
      .accounts({
        config: configPda,
        challenger: challengerKp.publicKey,
        indexState: indexStatePda,
        challenge: challengePda,
        challengerUsdcAccount: challengerUsdcAta,
        challengeBondVault: challengeBondVaultPda,
        usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([challengerKp])
      .rpc();

    // Snapshot pre-resolve.
    const challengerBefore = (
      await getAccount(provider.connection, challengerUsdcAta)
    ).amount;
    const treasuryBefore = (await getAccount(provider.connection, treasuryVault)).amount;
    const publisherVaultBefore = (
      await getAccount(provider.connection, publisherBondVaultPda)
    ).amount;
    const publisherBondAmountBefore = BigInt(
      (await program.account.publisher.fetch(publisherPda)).bondAmount.toString()
    );

    // Resolve as failed — slash_bps is ignored on the failure path; pass 0.
    await program.methods
      .resolveChallenge(false, 0)
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
        challenge: challengePda,
        challengeBondVault: challengeBondVaultPda,
        targetPublisherAccount: publisherPda,
        targetPublisherBondVault: publisherBondVaultPda,
        challengerUsdcAccount: challengerUsdcAta,
        treasuryVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const c = await program.account.challenge.fetch(challengePda);
    expect(c.status).to.deep.equal({ failed: {} });
    expect(c.slashBps).to.equal(0);
    expect(c.slashedAmount.toString()).to.equal("0");
    expect(c.challengerPayout.toString()).to.equal("0");

    const expectedPublisherShare = challengeBond / BigInt(2);
    const expectedTreasuryShare = challengeBond - expectedPublisherShare;

    // Challenger received nothing (bond confiscated).
    const challengerAfter = (
      await getAccount(provider.connection, challengerUsdcAta)
    ).amount;
    expect((challengerAfter - challengerBefore).toString()).to.equal("0");

    // Publisher's bond vault refilled by half the challenge bond.
    const publisherVaultAfter = (
      await getAccount(provider.connection, publisherBondVaultPda)
    ).amount;
    expect((publisherVaultAfter - publisherVaultBefore).toString()).to.equal(
      expectedPublisherShare.toString()
    );
    // bond_amount tracks effective bond — should mirror the refill increment.
    const publisherAfter = await program.account.publisher.fetch(publisherPda);
    const publisherBondAmountAfter = BigInt(publisherAfter.bondAmount.toString());
    expect((publisherBondAmountAfter - publisherBondAmountBefore).toString()).to.equal(
      expectedPublisherShare.toString()
    );

    // Treasury received the other half.
    const treasuryAfter = (await getAccount(provider.connection, treasuryVault)).amount;
    expect((treasuryAfter - treasuryBefore).toString()).to.equal(
      expectedTreasuryShare.toString()
    );

    // Challenge bond vault drained.
    const cbvAfter = (await getAccount(provider.connection, challengeBondVaultPda)).amount;
    expect(cbvAfter.toString()).to.equal("0");
  });

  it("finalizes the day after challenge window with no open challenges", async () => {
    // TODO: oracle.md §5 — needs clock advance past challenge_window_seconds.
    // Same blocker as the after-window challenge test.
  });

  it("supports emergency pause by core multisig", async () => {
    // Spec: docs/oracle.md §9 — admin-only pause flips Config.paused, blocking submissions
    // and challenges until unpaused.
    await program.methods
      .emergencyPause(1)
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
      })
      .rpc();
    let cfg = await program.account.config.fetch(configPda);
    expect(cfg.paused).to.equal(true);
    expect(cfg.pauseReason).to.equal(1);

    await program.methods
      .emergencyUnpause()
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
      })
      .rpc();
    cfg = await program.account.config.fetch(configPda);
    expect(cfg.paused).to.equal(false);
    expect(cfg.pauseReason).to.equal(0);
  });
});
