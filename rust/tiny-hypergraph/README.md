# tiny-hypergraph Rust port

First source translation pass of `tiny-hypergraph/lib` at commit
`c60c55266323974507ca3de06ff6ff3c4860436d`, inside the autorouter repository on
`codex/tiny-hypergraph-rust-port` (based on autorouter `22587834`).

[PORT_MAP.md](PORT_MAP.md) maps every library source file to its Rust counterpart.
The port covers the core and routing variants, bus planners, polygon geometry,
region graph, section pipelines, serialization adapters, utilities, and debug
visualizations. TypeScript tests, fixtures, benchmarks, and UI pages remain in
the source repository and are not part of this library translation pass.

The initial translation was followed by Rust formatting and compilation fixes.
`cargo fmt`, `cargo check`, and `cargo build` pass locally. The compiler reports
four dead-code warnings for retained source fields and helper methods.
The sibling [WASM bindings](../tiny-hypergraph-wasm/README.md) have basic Node
and Bun smoke tests. Full dispatch equivalence and TypeScript/Rust behavior
parity remain unverified. No linters or benchmarks have been run.

Translation conventions:

- Preserve source file boundaries, algorithm steps, constants, and failure cases.
- Use snake_case Rust file, field, and function names with original type names.
- Store signed port/region/route/net IDs as i32 so negative sentinels survive;
  use wider hop keys and usize vector indexes where required.
- Represent typed arrays as vectors and recursive candidates with shared links.
- Translate solver inheritance to composition with explicit dispatch at override
  points; these paths need particular attention during later parity testing.
- Keep external serialized graphs, metadata, and graphics as serde_json values,
  retaining their existing property names. This is an initial porting choice;
  it does not decide the eventual TypeScript/WASM boundary.
- Preserve recovery branches already present in the original implementation;
  the port is not an algorithm or fallback-policy rewrite.

The library builds for `wasm32-unknown-unknown`. The seeded shuffle needs no OS
randomness, and section timing uses `web-time` for JavaScript environments.

```sh
cargo build --manifest-path rust/tiny-hypergraph/Cargo.toml --locked
cargo build --manifest-path rust/tiny-hypergraph/Cargo.toml --locked --target wasm32-unknown-unknown
```

This crate remains a Rust library; the sibling bindings crate supplies the
JavaScript-callable WASM package. TypeScript integration is next. Automatic section
search still uses `catch_unwind`; expected candidate rejection must become
explicit error handling before exposing that path on the default WASM target,
where panics abort. Behavior parity remains unverified.
