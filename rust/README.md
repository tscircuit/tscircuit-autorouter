# Rust bindings

The `capacity-autorouter/src` tree mirrors this repository's `lib` tree. Dependency
crates use their npm package names without the scope and contain the ported subsets.
The WebAssembly entry points are `capacity-autorouter-bindings` and
`tiny-hypergraph-bindings`.
Their generated types use tsify with JSON transport. TypeScript adapters preserve
the public solver API, mutable object identity, and callbacks.

Install the build tools, then build from the repository root:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.128 --locked
bun run build
```

`WASM_BINDGEN` can select an existing matching executable. `bun run build:bindings`
rebuilds and embeds the modules; `bun run build:ts` rebuilds the package and
declarations. Package consumers do not need Rust or asynchronous initialization.

Each crate has its own Cargo manifest. Run native tests with
`cargo test --manifest-path rust/<crate>/Cargo.toml`. After building the bindings,
run the hypergraph adapter tests with
`bun run --cwd rust/tiny-hypergraph-bindings test`.
