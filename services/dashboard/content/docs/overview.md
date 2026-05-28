# What is Pokeperp?

Pokeperp is a decentralized **perpetual futures exchange on Solana** where you take
leveraged long or short positions on the **PSA 10 Modern Top 25 (PMT25)** — an index
of the 25 most-traded modern-era Pokémon cards in PSA 10 grade.

You're not buying or holding cards. You're trading a price feed: go **long** if you
think graded modern Pokémon prices rise, **short** if you think they fall, with
leverage, and settle in USDC.

## Why it exists

Graded card prices move a lot, but the market is illiquid and slow — there's no
clean way to get exposure (or hedge a collection) without buying physical cards and
paying grading, shipping, and spreads. Pokeperp turns the index into a liquid,
leverageable instrument that settles on-chain.

## How it fits together

- **The index (PMT25)** — a daily, methodology-driven value built from real eBay
  PSA 10 sold prices. See *The PMT25 Index*.
- **The perp engine** — an oracle-anchored vAMM with isolated margin, funding, and
  liquidation. See *Trading the perp*.
- **The oracle** — federated publishers push prices daily; the protocol aggregates
  a median and anyone can challenge a bad print. See *The oracle & price integrity*.

## Status

> Pokeperp is **live on Solana mainnet** and settles against real USDC. The PMT25
> index is live on-chain and updates daily. **Trading isn't open yet** — it opens
> once the insurance fund is seeded; we'll announce on [X / @PokePerp](https://x.com/PokePerp).
> The official **$POKE** contract address is `pokeHAfu5hjQbKaHfQJns3BUVRYMLvPfKJHKx9sBBtX`
> — only trust the CA shown on the Pokeperp home page.

Not affiliated with Nintendo, The Pokémon Company, or PSA.
