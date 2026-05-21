import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  useConnection,
  useWallet,
  type AnchorWallet,
} from "@solana/wallet-adapter-react";
import { useMemo } from "react";

import OracleIdl from "./idl/oracle.json";
import PerpEngineIdl from "./idl/perp_engine.json";
import type { Oracle } from "./idl/oracle";
import type { PerpEngine } from "./idl/perp_engine";

export const ORACLE_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ORACLE_PROGRAM_ID ??
    "GXEGbfvQvUh77udPyDYeVxgMZYd4BWLtu164dcLhqJ4i"
);

export const PERP_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PERP_PROGRAM_ID ??
    "Gtpv6K9Fi3pkYcYZEzqaS8DW2nqDwpwPf24Q1WxsQzsa"
);

/**
 * A no-op wallet that lets us construct a Program for read-only use.
 * Anchor requires a wallet on the provider; for getAccountInfo + decode flows
 * it's never actually called. Throws if used to sign — guard against accidental
 * writes via this provider.
 */
const READ_ONLY_PUBKEY = new PublicKey("11111111111111111111111111111111");
const readOnlyWallet: AnchorWallet = {
  publicKey: READ_ONLY_PUBKEY,
  signTransaction: async <T extends Transaction | VersionedTransaction>(
    _: T
  ): Promise<T> => {
    throw new Error("Read-only provider — connect a wallet to sign");
  },
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(
    _: T[]
  ): Promise<T[]> => {
    throw new Error("Read-only provider — connect a wallet to sign");
  },
};

/**
 * AnchorProvider bound to the connected wallet, or null if none.
 * Use for write paths (open_position, etc.).
 */
export function useAnchorProvider(): AnchorProvider | null {
  const { connection } = useConnection();
  const wallet = useWallet();

  return useMemo(() => {
    if (
      !wallet.publicKey ||
      !wallet.signTransaction ||
      !wallet.signAllTransactions
    ) {
      return null;
    }
    const anchorWallet: AnchorWallet = {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction,
      signAllTransactions: wallet.signAllTransactions,
    };
    return new AnchorProvider(
      connection,
      anchorWallet,
      AnchorProvider.defaultOptions()
    );
  }, [connection, wallet]);
}

/**
 * Read-only AnchorProvider. Always available regardless of wallet state.
 * Used for fetching on-chain account state for display.
 */
export function useReadOnlyProvider(): AnchorProvider {
  const { connection } = useConnection();
  return useMemo(
    () =>
      new AnchorProvider(connection, readOnlyWallet, {
        commitment: "confirmed",
      }),
    [connection]
  );
}

/** Typed read-only Program<Oracle>. */
export function useOracleProgram(): Program<Oracle> {
  const provider = useReadOnlyProvider();
  return useMemo(
    () => new Program<Oracle>(OracleIdl as unknown as Oracle, provider),
    [provider]
  );
}

/** Typed read-only Program<PerpEngine>. */
export function usePerpProgram(): Program<PerpEngine> {
  const provider = useReadOnlyProvider();
  return useMemo(
    () =>
      new Program<PerpEngine>(
        PerpEngineIdl as unknown as PerpEngine,
        provider
      ),
    [provider]
  );
}

/**
 * Variant of useOracleProgram that uses the connected-wallet provider when
 * available (for instructions that need to sign). Falls back to read-only.
 */
export function useOracleProgramRW(): {
  program: Program<Oracle>;
  canWrite: boolean;
} {
  const rwProvider = useAnchorProvider();
  const roProvider = useReadOnlyProvider();
  return useMemo(() => {
    const provider = rwProvider ?? roProvider;
    return {
      program: new Program<Oracle>(OracleIdl as unknown as Oracle, provider),
      canWrite: !!rwProvider,
    };
  }, [rwProvider, roProvider]);
}

export function usePerpProgramRW(): {
  program: Program<PerpEngine>;
  canWrite: boolean;
} {
  const rwProvider = useAnchorProvider();
  const roProvider = useReadOnlyProvider();
  return useMemo(() => {
    const provider = rwProvider ?? roProvider;
    return {
      program: new Program<PerpEngine>(
        PerpEngineIdl as unknown as PerpEngine,
        provider
      ),
      canWrite: !!rwProvider,
    };
  }, [rwProvider, roProvider]);
}

/* ============ PDA derivations ============ */

export function indexStatePda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("index_state")],
    ORACLE_PROGRAM_ID
  );
  return pda;
}

export function constituentRegistryPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registry")],
    ORACLE_PROGRAM_ID
  );
  return pda;
}

export function configPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    ORACLE_PROGRAM_ID
  );
  return pda;
}

export function marketPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market")],
    PERP_PROGRAM_ID
  );
  return pda;
}

export function insuranceFundPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_fund")],
    PERP_PROGRAM_ID
  );
  return pda;
}

export function insuranceVaultPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_vault")],
    PERP_PROGRAM_ID
  );
  return pda;
}

export function positionPda(trader: PublicKey, market: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), trader.toBuffer(), market.toBuffer()],
    PERP_PROGRAM_ID
  );
  return pda;
}
