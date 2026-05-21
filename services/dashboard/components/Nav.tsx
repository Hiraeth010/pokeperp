"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

import PokeperpLogo from "./PokeperpLogo";

export default function Nav() {
  return (
    <header className="border-b border-[rgb(var(--border-subtle))]/60 backdrop-blur-md sticky top-0 z-10 bg-[rgb(var(--background))]/85">
      <nav className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between">
        <Link
          href="/"
          className="group transition-opacity hover:opacity-90"
          aria-label="Pokeperp home"
        >
          <PokeperpLogo size="md" />
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
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={`relative px-3 py-1.5 rounded-md transition-colors ${
        active
          ? "text-white"
          : "text-[rgb(var(--muted))] hover:text-white hover:bg-[rgb(var(--background-elevated))]"
      }`}
    >
      {children}
      {active && (
        <span
          className="absolute left-3 right-3 -bottom-[14px] h-[2px] rounded-full"
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
