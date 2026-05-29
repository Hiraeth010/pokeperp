"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BaseWalletMultiButton } from "@solana/wallet-adapter-react-ui";

import PokeperpLogo from "./PokeperpLogo";
import XIcon from "./XIcon";

// Same as the default WalletMultiButton labels, but the disconnected state reads
// "Connect" instead of "Select Wallet" (shorter + clearer, esp. on mobile).
const WALLET_LABELS = {
  "change-wallet": "Change wallet",
  connecting: "Connecting …",
  "copy-address": "Copy address",
  copied: "Copied",
  disconnect: "Disconnect",
  "has-wallet": "Connect",
  "no-wallet": "Connect",
} as const;

export default function Nav() {
  return (
    <header className="border-b border-[rgb(var(--border-subtle))]/60 backdrop-blur-md sticky top-0 z-10 bg-[rgb(var(--background))]/85">
      <nav className="max-w-6xl mx-auto px-3 sm:px-4 py-3.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-2.5">
        <Link
          href="/"
          className="group transition-opacity hover:opacity-90 shrink-0"
          aria-label="Pokeperp home"
        >
          <PokeperpLogo size="md" />
        </Link>
        <div className="flex items-center gap-0.5 sm:gap-1 text-sm">
          <NavLink href="/">Index</NavLink>
          <NavLink href="/trade">Trade</NavLink>
          <NavLink href="/portfolio">Portfolio</NavLink>
          <NavLink href="/updates">Updates</NavLink>
          <NavLink href="/docs">Docs</NavLink>
          <a
            href="https://x.com/pokeperpsss"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Follow @pokeperpsss on X"
            title="Follow @pokeperpsss on X"
            className="hidden sm:inline-flex ml-1 p-2 rounded-md text-[rgb(var(--muted))] hover:text-white hover:bg-[rgb(var(--background-elevated))] transition-colors"
          >
            <XIcon size={14} />
          </a>
          <div className="ml-1 sm:ml-2">
            <BaseWalletMultiButton labels={WALLET_LABELS} />
          </div>
        </div>
      </nav>
    </header>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={`relative px-2 sm:px-3 py-1.5 rounded-md transition-colors ${
        active
          ? "text-white"
          : "text-[rgb(var(--muted))] hover:text-white hover:bg-[rgb(var(--background-elevated))]"
      }`}
    >
      {children}
      {active && (
        <span
          className="absolute left-2 right-2 sm:left-3 sm:right-3 -bottom-[14px] h-[2px] rounded-full"
          style={{
            background:
              "linear-gradient(90deg, rgb(var(--electric-from)), rgb(var(--electric-to)))",
            boxShadow: "0 0 8px rgba(255, 195, 0, 0.5)",
          }}
        />
      )}
    </Link>
  );
}
