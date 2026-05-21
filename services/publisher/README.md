# pokeperp-publisher

Reference implementation of the Pokeperp oracle publisher service.

**Design**: see [docs/publisher.md](../../docs/publisher.md) at the repo root for full architecture, configuration, and operational details.

## Quick start

```sh
cp examples/publisher.example.toml /etc/pokeperp/publisher.toml
# Edit the file: set publisher_keypair_path, eBay credentials, etc.

cargo build --release
./target/release/pokeperp-publisher run --dry-run    # staging
./target/release/pokeperp-publisher run              # mainnet, real submission
```

## Subcommands

- `run [--dry-run]` — daily routine: fetch, compute, (optionally) submit
- `backfill --from YYYY-MM-DD --to YYYY-MM-DD` — historical compute, no submission
- `verify --day N` — re-run a day's computation and diff against on-chain state

## Status

v0.1 scaffold — every module has typed signatures and `// TODO:` markers pointing to spec sections. Business logic is not implemented.
