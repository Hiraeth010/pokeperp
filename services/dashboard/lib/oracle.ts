"use client";

import { Connection } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";

import {
  constituentRegistryPda,
  indexStatePda,
  ORACLE_PROGRAM_ID,
  useOracleProgram,
} from "./anchor";
import type { Oracle } from "./idl/oracle";
import { bytesToString } from "./format";

/* ============ Public types ============ */

export type IndexStatus = "Provisional" | "Final" | "Stale" | "Frozen";

export interface IndexState {
  day: number;
  status: IndexStatus;
  aggregatedPrices: bigint[]; // 25 entries, micro-USDC
  constituentStatus: number[]; // 25 entries, 0=ok,1=stale,2=ejected
  indexValue: bigint; // ×1e6
  finalizedAt: number; // unix seconds
}

export interface Constituent {
  setCode: string;
  collectorNumber: number;
  setTotal: number;
  variantCode: string;
  basePrice: bigint;
  canonicalSearchHash: Uint8Array;
}

export interface ConstituentRegistry {
  version: number;
  effectiveDay: number;
  constituents: Constituent[]; // 25 entries
}

/* ============ Decoders ============ */

function decodeIndexStatus(raw: unknown): IndexStatus {
  // Anchor encodes enums as { variantName: {} }
  const obj = raw as Record<string, unknown>;
  if ("provisional" in obj) return "Provisional";
  if ("final" in obj) return "Final";
  if ("stale" in obj) return "Stale";
  if ("frozen" in obj) return "Frozen";
  return "Provisional";
}

interface RawIndexState {
  day: number;
  status: unknown;
  aggregatedPrices: { toString: () => string }[];
  constituentStatus: number[];
  indexValue: { toString: () => string };
  finalizedAt: { toNumber?: () => number; toString: () => string };
}

function decodeIndexStateRaw(raw: RawIndexState): IndexState {
  return {
    day: raw.day,
    status: decodeIndexStatus(raw.status),
    aggregatedPrices: raw.aggregatedPrices.map((bn) => BigInt(bn.toString())),
    constituentStatus: raw.constituentStatus,
    indexValue: BigInt(raw.indexValue.toString()),
    finalizedAt:
      raw.finalizedAt.toNumber?.() ?? Number(raw.finalizedAt.toString()),
  };
}

/* ============ Bare fetches (no React) ============ */

export async function fetchIndexState(
  program: Program<Oracle>
): Promise<IndexState | null> {
  const raw = await program.account.indexState.fetchNullable(indexStatePda());
  if (!raw) return null;
  return decodeIndexStateRaw(raw as unknown as RawIndexState);
}

export async function fetchConstituentRegistry(
  program: Program<Oracle>
): Promise<ConstituentRegistry | null> {
  const pda = constituentRegistryPda();
  // Zero-copy account — use Anchor's account namespace which handles repr(C) layout.
  const raw = await program.account.constituentRegistry.fetchNullable(pda);
  if (!raw) return null;
  return {
    version: raw.version,
    effectiveDay: raw.effectiveDay,
    constituents: raw.constituents.map(
      (c: {
        setCode: number[];
        collectorNumber: number;
        setTotal: number;
        variantCode: number[];
        basePrice: { toString: () => string };
        canonicalSearchHash: number[];
      }) => ({
        setCode: bytesToString(c.setCode),
        collectorNumber: c.collectorNumber,
        setTotal: c.setTotal,
        variantCode: bytesToString(c.variantCode),
        basePrice: BigInt(c.basePrice.toString()),
        canonicalSearchHash: Uint8Array.from(c.canonicalSearchHash),
      })
    ),
  };
}

/** Subscribe to IndexState account changes via the Program's coder. */
export function subscribeIndexState(
  program: Program<Oracle>,
  onChange: (state: IndexState | null) => void
): () => void {
  const connection = program.provider.connection;
  const pda = indexStatePda();
  const subId = connection.onAccountChange(
    pda,
    (info) => {
      try {
        const raw = program.coder.accounts.decode("indexState", info.data);
        onChange(decodeIndexStateRaw(raw as RawIndexState));
      } catch (err) {
        console.error("IndexState subscription decode failed:", err);
        onChange(null);
      }
    },
    "confirmed"
  );
  return () => {
    connection.removeAccountChangeListener(subId).catch(() => {});
  };
}

/* ============ React hooks ============ */

type FetchState<T> =
  | { status: "loading" }
  | { status: "missing" /* program/account doesn't exist on this RPC */ }
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

/**
 * Live IndexState: initial fetch + websocket subscription.
 * Returns `{ status: "missing" }` when the account doesn't exist on the RPC
 * (e.g., programs not deployed to this cluster).
 */
export function useIndexState(): FetchState<IndexState> {
  const program = useOracleProgram();
  const [state, setState] = useState<FetchState<IndexState>>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      try {
        const initial = await fetchIndexState(program);
        if (cancelled) return;
        setState(
          initial ? { status: "ready", data: initial } : { status: "missing" }
        );
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }

      unsubscribe = subscribeIndexState(program, (next) => {
        if (cancelled) return;
        setState(
          next ? { status: "ready", data: next } : { status: "missing" }
        );
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [program]);

  return state;
}

/** Live constituent registry. Updates on demand (no subscription — changes monthly). */
export function useConstituentRegistry(): FetchState<ConstituentRegistry> {
  const program = useOracleProgram();
  const [state, setState] = useState<FetchState<ConstituentRegistry>>({
    status: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const reg = await fetchConstituentRegistry(program);
        if (cancelled) return;
        setState(
          reg ? { status: "ready", data: reg } : { status: "missing" }
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
    };
  }, [program]);

  return state;
}

/** Reference to the configured oracle program ID, for display. */
export function oracleProgramAddress(): string {
  return ORACLE_PROGRAM_ID.toBase58();
}

/** A safe display label for a constituent — falls back to set+number when codes are empty. */
export function constituentLabel(c: Constituent): string {
  const set = c.setCode || "?";
  const variant = c.variantCode ? ` · ${c.variantCode}` : "";
  return `${set} #${c.collectorNumber}${variant}`;
}
