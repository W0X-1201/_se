# Stage 1: build
FROM rust:1.83-slim AS builder
WORKDIR /app
COPY Cargo.toml ./
COPY src ./src
RUN cargo build --release

# Stage 2: run (minimal runtime image)
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/rust-app .

EXPOSE 8080

CMD ["./rust-app"]
