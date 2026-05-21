"use client";

import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback } from "react";

import { indexStatePda, usePerpProgramRW } from "./anchor";
import { useMarket } from "./perp";

export interface OpenParams {
  side: "long" | "short";
  /** Notional position size in USDC (e.g. 500 for $500). */
  sizeUsdc: number;
  /** Margin to post in USDC. */
  marginUsdc: number;
}

export interface MarginParams {
  /** USDC amount to add or withdraw. */
  amountUsdc: number;
}

export type TradeResult =
  | { ok: true; signature: string }
  | { ok: false; error: string };

const usdcToMicro = (n: number): BN =>
  new BN(Math.round(n * 1_000_000).toString());

/**
 * Trade actions bound to the connected wallet. Each returns a TradeResult
 * (no thrown errors leak into the UI). PDAs auto-resolve from the IDL via
 * Anchor's methods builder; we only specify accounts that aren't seeded.
 */
export function useTradeActions() {
  const { publicKey } = useWallet();
  const { program, canWrite } = usePerpProgramRW();
  const market = useMarket();
  const usdcMint =
    market.status === "ready" ? market.data.usdcMint : null;
  const ready = canWrite && usdcMint !== null;

  /**
   * Ensure the trader has a USDC ATA. Returns the ATA address and any
   * pre-instruction needed to create it.
   */
  const prepareAta = useCallback(
    async (
      mint: PublicKey,
      owner: PublicKey
    ): Promise<{
      ata: PublicKey;
      preIxs: Awaited<ReturnType<typeof createAssociatedTokenAccountInstruction>>[];
    }> => {
      const ata = await getAssociatedTokenAddress(mint, owner);
      const info = await program.provider.connection.getAccountInfo(ata);
      const preIxs = info
        ? []
        : [createAssociatedTokenAccountInstruction(owner, ata, owner, mint)];
      return { ata, preIxs };
    },
    [program]
  );

  const openPosition = useCallback(
    async ({ side, sizeUsdc, marginUsdc }: OpenParams): Promise<TradeResult> => {
      if (!publicKey) return { ok: false, error: "Connect a wallet first" };
      if (!ready || !usdcMint)
        return { ok: false, error: "Market not initialized on this cluster" };

      try {
        const sizeMicro = usdcToMicro(sizeUsdc);
        const signedSize = side === "long" ? sizeMicro : sizeMicro.neg();
        const marginMicro = usdcToMicro(marginUsdc);

        const { ata, preIxs } = await prepareAta(usdcMint, publicKey);

        const sig = await program.methods
          .openPosition(signedSize, marginMicro)
          .accounts({
            trader: publicKey,
            traderUsdcAccount: ata,
            usdcMint,
            indexState: indexStatePda(),
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          } as never)
          .preInstructions(preIxs)
          .rpc();
        return { ok: true, signature: sig };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [publicKey, ready, usdcMint, program, prepareAta]
  );

  const closePosition = useCallback(async (): Promise<TradeResult> => {
    if (!publicKey) return { ok: false, error: "Connect a wallet first" };
    if (!ready || !usdcMint)
      return { ok: false, error: "Market not initialized on this cluster" };

    try {
      const { ata, preIxs } = await prepareAta(usdcMint, publicKey);

      const sig = await program.methods
        .closePosition()
        .accounts({
          trader: publicKey,
          traderUsdcAccount: ata,
          usdcMint,
          indexState: indexStatePda(),
          tokenProgram: TOKEN_PROGRAM_ID,
        } as never)
        .preInstructions(preIxs)
        .rpc();
      return { ok: true, signature: sig };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [publicKey, ready, usdcMint, program, prepareAta]);

  const addMargin = useCallback(
    async ({ amountUsdc }: MarginParams): Promise<TradeResult> => {
      if (!publicKey) return { ok: false, error: "Connect a wallet first" };
      if (!ready || !usdcMint)
        return { ok: false, error: "Market not initialized on this cluster" };

      try {
        const { ata, preIxs } = await prepareAta(usdcMint, publicKey);
        const sig = await program.methods
          .addMargin(usdcToMicro(amountUsdc))
          .accounts({
            trader: publicKey,
            traderUsdcAccount: ata,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as never)
          .preInstructions(preIxs)
          .rpc();
        return { ok: true, signature: sig };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [publicKey, ready, usdcMint, program, prepareAta]
  );

  const withdrawMargin = useCallback(
    async ({ amountUsdc }: MarginParams): Promise<TradeResult> => {
      if (!publicKey) return { ok: false, error: "Connect a wallet first" };
      if (!ready || !usdcMint)
        return { ok: false, error: "Market not initialized on this cluster" };

      try {
        const { ata, preIxs } = await prepareAta(usdcMint, publicKey);
        const sig = await program.methods
          .withdrawMargin(usdcToMicro(amountUsdc))
          .accounts({
            trader: publicKey,
            traderUsdcAccount: ata,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as never)
          .preInstructions(preIxs)
          .rpc();
        return { ok: true, signature: sig };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [publicKey, ready, usdcMint, program, prepareAta]
  );

  return { openPosition, closePosition, addMargin, withdrawMargin, ready };
}
