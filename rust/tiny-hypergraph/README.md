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
No tests, linters, or benchmarks have been run. Dispatch equivalence and behavior
parity remain unverified; compilation does not establish behavioral equivalence.

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

Next passes, deliberately deferred: port/run selected source tests and compare
behavior, then design WASM packaging and TypeScript calls. There are no WASM bindings, JavaScript loading changes, generated binaries,
or published packages in this pass.
