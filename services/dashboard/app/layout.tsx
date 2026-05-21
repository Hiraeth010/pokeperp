import "./globals.css";
import type { Metadata } from "next";
import WalletProvider from "@/components/WalletProvider";
import Nav from "@/components/Nav";

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
    <html lang="en">
      <body>
        <WalletProvider>
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
