FROM rust:1.95-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev clang cmake curl git && rm -rf /var/lib/apt/lists/*
RUN rustup target add wasm32-unknown-unknown && rustup component add rust-src
RUN cargo install --locked cargo-stylus --version 0.10.9
WORKDIR /work
