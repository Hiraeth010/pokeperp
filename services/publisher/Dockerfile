# Multi-stage build for the Pokeperp publisher crank.
#
# The publisher is a standalone Rust crate (its Cargo.toml declares an empty
# [workspace], detaching it from the on-chain Anchor workspace at the repo
# root), so the build context is just services/publisher/.
#
# Deployed as an always-on worker (no HTTP server — see railway.toml: no
# healthcheck). Runs the `crank` subcommand: poll every 60s, submit + aggregate
# current_day-1 whenever it isn't already done.

# ---- builder ----
# Pinned to match the toolchain that generated Cargo.lock (1.95). Must be >= 1.85:
# the locked block-buffer 0.12.0 requires the edition2024 Cargo feature, which is
# only stable from Rust 1.85. Bump deliberately, not via :latest.
FROM rust:1.95-slim-bookworm AS builder

# solana-client 1.18 needs OpenSSL (native-tls, unified in via solana-client's
# reqwest features) and libudev; the rest are standard native-build tooling.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        pkg-config \
        libssl-dev \
        libudev-dev \
        clang \
        cmake \
        protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

# ---- runtime ----
FROM debian:bookworm-slim

# ca-certificates for outbound TLS (scraper + RPC over HTTPS); libssl3/libudev1
# are the runtime halves of the build-time -dev packages.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        libssl3 \
        libudev1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/target/release/pokeperp-publisher /usr/local/bin/pokeperp-publisher
# Config only — NO keypair is baked into the image. The signing key is injected
# at runtime via the PUBLISHER_KEYPAIR_JSON env var (a Railway secret), read by
# load_publisher_keypair() in main.rs. See railway.toml.
COPY examples ./examples

ENTRYPOINT ["pokeperp-publisher"]
CMD ["--config", "examples/publisher.devnet.toml", "crank", "--interval-secs", "60"]
