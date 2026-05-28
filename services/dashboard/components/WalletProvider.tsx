"use client";

import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { useMemo } from "react";

import "@solana/wallet-adapter-react-ui/styles.css";

export default function WalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Route HTTP RPC through our same-origin server proxy (/api/rpc) so the
  // upstream (Helius) key stays server-side, never in the client bundle. The
  // SSR fallback is only used during server render (no requests are made then);
  // the client recomputes to the proxy URL on mount.
  const endpoint = useMemo(
    () =>
      typeof window !== "undefined"
        ? `${window.location.origin}/api/rpc`
        : "https://api.devnet.solana.com",
    []
  );
  // WebSocket subscriptions (account-change) can't go through the HTTP proxy, so
  // they use a keyless public WS endpoint. Override via NEXT_PUBLIC_RPC_WS.
  const config = useMemo(
    () => ({
      commitment: "confirmed" as const,
      wsEndpoint:
        process.env.NEXT_PUBLIC_RPC_WS ?? "wss://api.devnet.solana.com",
    }),
    []
  );
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <SolanaWalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
