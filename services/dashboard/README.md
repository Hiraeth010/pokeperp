# pokeperp-dashboard

Trader-facing Next.js app for Pokeperp.

**Design**: see [docs/dashboard.md](../../docs/dashboard.md) at the repo root.

## Setup

```sh
cp .env.example .env.local
# Set NEXT_PUBLIC_RPC_URL to your preferred RPC endpoint (Helius / Triton recommended for production).

npm install
npm run dev
```

Open <http://localhost:3000>.

## Status

v0.1 scaffold. Three pages render with placeholder data:

- `/` — index value card + top movers / market state stubs
- `/trade` — chart placeholder + functional side toggle / size input / leverage slider; submit alerts "not implemented"
- `/portfolio` — wallet-gated position / PnL / funding stubs

Wallet adapter (Phantom + Solflare) and Tailwind are wired. Anchor client setup is in `lib/anchor.ts`. Account reads (`lib/oracle.ts`, `lib/perp.ts`) and trade tx construction are stubbed with `// TODO:` markers referencing the spec.

## Version-skew note

Wallet-adapter packages have historically lagged on Next.js / React majors. If `npm install` produces peer dependency warnings or hydration issues, the most likely culprit is `@solana/wallet-adapter-*` not yet supporting the React 19 / Next 15 combo — pin to compatible versions or downgrade Next/React until adapters catch up.
