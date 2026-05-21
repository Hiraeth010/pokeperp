/**
 * Pokeperp deploy script.
 *
 * Sequencing:
 *   1. Initialize oracle Config (oracle.md §2). [IMPLEMENTED]
 *   2. Register initial publisher set (oracle.md §2 — 3 publishers for phase 0 shadow). [TODO]
 *   3. Set inception constituent registry (methodology.md §1 + inception-candidates.md). [TODO]
 *   4. Initialize perp-engine Market against oracle IndexState (perp-engine.md §2). [TODO]
 *   5. Seed insurance fund with 100k USDC from treasury (perp-engine.md §7). [TODO]
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { Oracle } from "../target/types/oracle";

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);

  const oracleProgram = anchor.workspace.Oracle as anchor.Program<Oracle>;

  // 1. Initialize oracle Config.
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    oracleProgram.programId
  );

  // Skip if already initialized (idempotent re-run).
  const existing = await oracleProgram.account.config.fetchNullable(configPda);
  if (existing) {
    console.log("Oracle Config already initialized at", configPda.toBase58());
  } else {
    await oracleProgram.methods
      .initialize({
        publisherBond: new anchor.BN(10_000_000_000), // 10,000 USDC
        challengeBond: new anchor.BN(1_000_000_000), // 1,000 USDC
        minPublishersPerDay: 3,
        submissionWindowStart: 20 * 3600,
        submissionWindowEnd: 24 * 3600 - 1,
        challengeWindowSeconds: 3600,
      })
      .accounts({
        config: configPda,
        admin: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("Oracle Config initialized at", configPda.toBase58());
  }

  // TODO 2: oracle.register_publisher(...) × 3 (oracle.md §2)
  // TODO 3: oracle.initialize_registry()                            (one-time)
  //         oracle.update_constituent(idx, c) × 25                  (per inception)
  //         oracle.finalize_registry_update(effective_day)          (commits v1)
  // TODO 4: perpEngineProgram.initialize_insurance_fund()           (perp-engine.md §7)
  // TODO 5: perpEngineProgram.initialize_market(phase0Params)       (perp-engine.md §2)
  // TODO 6: transfer 100_000 USDC to insurance_fund.vault           (perp-engine.md §7)
};
