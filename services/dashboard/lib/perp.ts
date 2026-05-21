"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";

import {
  insuranceFundPda,
  marketPda,
  PERP_PROGRAM_ID,
  usePerpProgram,
} from "./anchor";

/* ============ Public types ============ */

export interface Market {
  admin: PublicKey;
  oracleIndexState: PublicKey;
  usdcMint: PublicKey;
  insuranceFund: PublicKey;
  phase: number;

  slippageFactor: number; // ×1e6
  oiFloor: bigint;

  longOi: bigint;
  shortOi: bigint;
  maxOiPerSide: bigint;
  maxPositionPerTrader: bigint;

  initialMarginBps: number;
  maintenanceMarginBps: number;

  fundingCapPerHourBps: number;
  lastFundingUpdate: number;
  cumulativeFundingLong: bigint;
  cumulativeFundingShort: bigint;

  markTwap1H: bigint;
  markTwap5Min: bigint;

  takerFeeBps: number;
  liquidationPenaltyBps: number;

  tradingPaused: boolean;
  fundingPaused: boolean;
  pauseReason: number;
}

export interface InsuranceFund {
  vault: PublicKey;
  floor: bigint;
  totalDeposited: bigint;
  totalPaidOut: bigint;
}

export interface Position {
  address: PublicKey;
  trader: PublicKey;
  market: PublicKey;
  size: bigint; // signed: + = long, - = short, micro-USDC notional
  entryIndexPrice: bigint;
  entryMarkPrice: bigint;
  marginVault: PublicKey;
  cumulativeFundingSnapshot: bigint;
  openedAt: number;
}

/* ============ React hooks ============ */

type FetchState<T> =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

interface AnchorBN {
  toString: () => string;
  toNumber?: () => number;
}

function bnToBig(bn: AnchorBN): bigint {
  return BigInt(bn.toString());
}

function bnToNum(bn: AnchorBN): number {
  return bn.toNumber?.() ?? Number(bn.toString());
}

/** Live Market state. Subscribes to account changes. */
export function useMarket(): FetchState<Market> {
  const { connection } = useConnection();
  const program = usePerpProgram();
  const [state, setState] = useState<FetchState<Market>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let subId: number | null = null;

    (async () => {
      try {
        const pda = marketPda();
        const raw = await program.account.market.fetchNullable(pda);
        if (cancelled) return;
        if (!raw) {
          setState({ status: "missing" });
        } else {
          setState({ status: "ready", data: decodeMarket(raw) });
        }

        subId = connection.onAccountChange(
          pda,
          (info) => {
            try {
              const decoded = program.coder.accounts.decode("market", info.data);
              if (!cancelled) {
                setState({ status: "ready", data: decodeMarket(decoded) });
              }
            } catch (err) {
              console.error("Market subscription decode failed:", err);
            }
          },
          "confirmed"
        );
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
      if (subId !== null) {
        connection.removeAccountChangeListener(subId).catch(() => {});
      }
    };
  }, [connection, program]);

  return state;
}

/** Live InsuranceFund metadata. */
export function useInsuranceFund(): FetchState<InsuranceFund> {
  const program = usePerpProgram();
  const [state, setState] = useState<FetchState<InsuranceFund>>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await program.account.insuranceFund.fetchNullable(
          insuranceFundPda()
        );
        if (cancelled) return;
        if (!raw) {
          setState({ status: "missing" });
        } else {
          setState({
            status: "ready",
            data: {
              vault: raw.vault,
              floor: bnToBig(raw.floor),
              totalDeposited: bnToBig(raw.totalDeposited),
              totalPaidOut: bnToBig(raw.totalPaidOut),
            },
          });
        }
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [program]);

  return state;
}

/** All Position accounts for a given trader. */
export function usePositions(trader: PublicKey | null): FetchState<Position[]> {
  const { connection } = useConnection();
  const program = usePerpProgram();
  const [state, setState] = useState<FetchState<Position[]>>({
    status: "loading",
  });

  useEffect(() => {
    if (!trader) {
      setState({ status: "ready", data: [] });
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        // getProgramAccounts with memcmp at the trader-pubkey offset (8 = discriminator).
        const accounts = await connection.getProgramAccounts(PERP_PROGRAM_ID, {
          filters: [
            { memcmp: { offset: 8, bytes: trader.toBase58() } },
            // Note: no dataSize filter — anchor accounts vary; memcmp on trader is sufficient
            // because no other account type starts with a trader pubkey at offset 8.
          ],
          commitment: "confirmed",
        });
        if (cancelled) return;

        const positions: Position[] = [];
        for (const { pubkey, account } of accounts) {
          try {
            const decoded = program.coder.accounts.decode(
              "position",
              account.data
            );
            positions.push({
              address: pubkey,
              trader: decoded.trader,
              market: decoded.market,
              size: bnToBig(decoded.size),
              entryIndexPrice: bnToBig(decoded.entryIndexPrice),
              entryMarkPrice: bnToBig(decoded.entryMarkPrice),
              marginVault: decoded.marginVault,
              cumulativeFundingSnapshot: bnToBig(
                decoded.cumulativeFundingSnapshot
              ),
              openedAt: bnToNum(decoded.openedAt),
            });
          } catch {
            // Not a Position account (e.g., another type matched the memcmp coincidentally) — skip.
          }
        }
        setState({ status: "ready", data: positions });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connection, program, trader]);

  return state;
}

/* ============ Decoding ============ */

interface RawMarket {
  admin: PublicKey;
  oracleIndexState: PublicKey;
  usdcMint: PublicKey;
  insuranceFund: PublicKey;
  phase: number;
  slippageFactor: number;
  oiFloor: AnchorBN;
  longOi: AnchorBN;
  shortOi: AnchorBN;
  maxOiPerSide: AnchorBN;
  maxPositionPerTrader: AnchorBN;
  initialMarginBps: number;
  maintenanceMarginBps: number;
  fundingCapPerHourBps: number;
  lastFundingUpdate: AnchorBN;
  cumulativeFundingLong: AnchorBN;
  cumulativeFundingShort: AnchorBN;
  markTwap1H: AnchorBN;
  markTwap5Min: AnchorBN;
  takerFeeBps: number;
  liquidationPenaltyBps: number;
  tradingPaused: boolean;
  fundingPaused: boolean;
  pauseReason: number;
}

function decodeMarket(raw: RawMarket): Market {
  return {
    admin: raw.admin,
    oracleIndexState: raw.oracleIndexState,
    usdcMint: raw.usdcMint,
    insuranceFund: raw.insuranceFund,
    phase: raw.phase,
    slippageFactor: raw.slippageFactor,
    oiFloor: bnToBig(raw.oiFloor),
    longOi: bnToBig(raw.longOi),
    shortOi: bnToBig(raw.shortOi),
    maxOiPerSide: bnToBig(raw.maxOiPerSide),
    maxPositionPerTrader: bnToBig(raw.maxPositionPerTrader),
    initialMarginBps: raw.initialMarginBps,
    maintenanceMarginBps: raw.maintenanceMarginBps,
    fundingCapPerHourBps: raw.fundingCapPerHourBps,
    lastFundingUpdate: bnToNum(raw.lastFundingUpdate),
    cumulativeFundingLong: bnToBig(raw.cumulativeFundingLong),
    cumulativeFundingShort: bnToBig(raw.cumulativeFundingShort),
    markTwap1H: bnToBig(raw.markTwap1H),
    markTwap5Min: bnToBig(raw.markTwap5Min),
    takerFeeBps: raw.takerFeeBps,
    liquidationPenaltyBps: raw.liquidationPenaltyBps,
    tradingPaused: raw.tradingPaused,
    fundingPaused: raw.fundingPaused,
    pauseReason: raw.pauseReason,
  };
}

/** Phase label for display, matches perp-engine.md §11. */
export function phaseLabel(phase: number): string {
  switch (phase) {
    case 0:
      return "phase 0 · shadow";
    case 1:
      return "phase 1 · soft launch";
    case 2:
      return "phase 2 · full";
    case 3:
      return "phase 3 · permissionless";
    default:
      return `phase ${phase}`;
  }
}

/** Compute funding rate (×1e6 scale) from market.cumulativeFundingLong delta. UI only. */
export function fundingRateBps(market: Market): number {
  // Quick-and-dirty: cumulative scaled by 1e6 per hour. Convert to bps for display.
  // This shows the LAST hour's contribution; for richer history we'd need snapshots.
  // TODO: track previous cumulativeFundingLong client-side to compute the actual hourly delta.
  return Math.round(
    (Number(market.cumulativeFundingLong) / 1_000_000) * 10_000
  );
}
