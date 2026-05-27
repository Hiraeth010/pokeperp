import "./globals.css";
import type { Metadata } from "next";
import { Inter, Russo_One } from "next/font/google";
import WalletProvider from "@/components/WalletProvider";
import Nav from "@/components/Nav";
import DevnetBanner from "@/components/DevnetBanner";

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const display = Russo_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pokeperp · perpetuals on PSA 10 Modern Top 25",
  description:
    "Solana perpetual futures DEX on the PSA 10 Modern Top 25 Pokemon card index.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body className="font-sans">
        <WalletProvider>
          {/* Devnet warning — sits above the nav so it's the first thing visitors
              see. Remove this when we point at mainnet. */}
          <DevnetBanner />
          <Nav />
          <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
          <footer className="max-w-6xl mx-auto px-4 py-10 mt-12 text-center text-[10px] text-[rgb(var(--muted))]">
            Pokeperp · settles vs PMT25 · not affiliated with Nintendo, The
            Pokémon Company, or PSA
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
