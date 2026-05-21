"use client";

import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Nav() {
  return (
    <header className="border-b border-[rgb(var(--border-subtle))]/60 backdrop-blur-sm sticky top-0 z-10 bg-[rgb(var(--background))]/85">
      <nav className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <span
            className="inline-block h-6 w-6 rounded-md"
            style={{
              background:
                "linear-gradient(135deg, rgb(var(--electric-from)) 0%, rgb(var(--fire-to)) 50%, rgb(var(--psychic-from)) 100%)",
              boxShadow: "0 0 12px -2px rgba(255, 195, 0, 0.4)",
            }}
            aria-hidden="true"
          />
          <span className="font-bold tracking-tight text-base group-hover:text-white transition-colors">
            Pokeperp
          </span>
        </Link>
        <div className="flex items-center gap-1 text-sm">
          <NavLink href="/">Index</NavLink>
          <NavLink href="/trade">Trade</NavLink>
          <NavLink href="/portfolio">Portfolio</NavLink>
          <div className="ml-2">
            <WalletMultiButton />
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
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-md text-[rgb(var(--muted))] hover:text-white hover:bg-[rgb(var(--background-elevated))] transition-colors"
    >
      {children}
    </Link>
  );
}
