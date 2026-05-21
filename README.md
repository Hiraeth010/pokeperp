# Pokeperp

A Solana perpetual futures DEX settling against the **PSA 10 Modern Top 25** Pokemon card index.

## Status

Pre-MVP. Design specs are stable at:

- `methodology.md` v0.2
- `oracle.md` v0.1
- `perp-engine.md` v0.1
- `inception-candidates.md` v0.1 (17/25 candidates verified)

On-chain programs are scaffolded with account structs and instruction stubs that match the specs; **business logic is not implemented**.

## Read order for new contributors

1. [docs/methodology.md](docs/methodology.md) — what the index *is*, how constituents are picked, edge cases.
2. [docs/oracle.md](docs/oracle.md) — federated publisher design, daily push cadence, dispute mechanism.
3. [docs/perp-engine.md](docs/perp-engine.md) — oracle-anchored vAMM, margin/liquidation, funding, circuit breakers.
4. [docs/inception-candidates.md](docs/inception-candidates.md) — verified candidate list and methodology validation against real data.
5. `programs/oracle/src/lib.rs` and `programs/perp-engine/src/lib.rs` — instruction stubs, each with a `Spec:` comment pointing to the relevant section.

## Repo layout

```
pokeperp/
├── Anchor.toml             Anchor workspace (program IDs, scripts)
├── Cargo.toml              Rust workspace root (programs only)
├── docs/                   Design specs (read these first)
├── programs/
│   ├── oracle/             Publisher submissions, index aggregation, challenges
│   └── perp-engine/        Market state, positions, funding, liquidation
├── services/
│   ├── publisher/          Off-chain publisher binary (fetches eBay → submits PriceUpdate)
│   └── dashboard/          Next.js trader dashboard (index / trade / portfolio)
├── tests/                  TypeScript integration tests
└── migrations/             Deploy script
```

## Build

```sh
anchor build
anchor test
```

The scaffold compiles but does not implement any business logic. Each instruction returns `Ok(())` with a TODO referencing the spec section to implement.

## Off-chain components

- **Publisher binary** (`services/publisher/`): Rust service that pulls eBay sold-listings data, applies methodology §6 trimmed-mean rule, and submits `PriceUpdate` accounts to the oracle program. Scaffolded with config loader, source trait, methodology pipeline, merkle, and submit modules — all stubbed. See [docs/publisher.md](docs/publisher.md).
- **Trader dashboard** (`services/dashboard/`): Next.js 15 app with App Router, Tailwind, Solana wallet adapter. Pages `/`, `/trade`, `/portfolio` render with placeholder data. Anchor client setup is wired; account reads and trade tx construction are stubbed with spec references. See [docs/dashboard.md](docs/dashboard.md).

## License

TBD.
