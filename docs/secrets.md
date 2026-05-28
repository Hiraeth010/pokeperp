# Secrets & key management

**Rule: no private keys, API keys, or tokens in git — ever.** Every service reads
its secrets from environment variables (Railway/Vercel) or gitignored local
files. The repo is public; treat anything committed as published.

## Per-service secrets

| Service | Secret (env var) | What | Set in |
|---|---|---|---|
| publisher-crank | `PUBLISHER_KEYPAIR_JSON` | publisher signing key (Solana keypair byte array) | Railway |
| publisher-crank | `RPC_URL` | Solana RPC (Helius) | Railway |
| keeper | `KEEPER_KEYPAIR_JSON` | keeper signing key | Railway |
| keeper | `RPC_URL` | Solana RPC (Helius) | Railway |
| monitor | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | alert channel | Railway |
| monitor | `RPC_URL` | Solana RPC (Helius) | Railway |
| indexer | `RPC_URL`, `RPC_WS` | Solana RPC / WS | Railway |
| dashboard (Vercel) | `RPC_URL` | server-side RPC for the `/api/rpc` proxy (Helius). **Never** `NEXT_PUBLIC_RPC_URL` — that inlines the key into the client bundle. | Vercel |
| dashboard (Vercel) | `INDEXER_URL` | indexer base URL for snapshot proxy | Vercel |

## Local development

Gitignored files hold local secrets:
- `services/publisher/devnet-keys/*.json` — devnet publisher keys (fallback when `PUBLISHER_KEYPAIR_JSON` unset).
- `services/keeper/keeper-keypair.json` — devnet keeper key (fallback).
- `services/dashboard/.env.devnet.local` — `RPC_URL` (Helius) for the helper scripts + dashboard.
- `services/dashboard/scripts/squads/keys/*.json` — multisig co-signer keys.

## Mainnet

- Generate **fresh** keys for every role; never reuse the devnet keys (they exist in this repo's git history and are devnet-only).
- Admin authority goes to a Squads multisig with **independently-custodied** co-signers (hardware wallets / separate people), not keys on one machine — see `services/dashboard/scripts/squads/`.
- Set all secrets via the platform's secret store; confirm `NEXT_PUBLIC_*` never contains a key.
