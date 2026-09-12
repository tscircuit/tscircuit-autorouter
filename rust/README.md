# Rust source ports and bindings

Solver files retain their TypeScript source names and decomposition. Behavioral comparisons use the frozen checkout at `22800e78` with its retained local changes. The separate [upstream main audit at 109c67b](https://github.com/tscircuit/tscircuit-autorouter/tree/109c67baebc709be95fb37df1fdac9b3b74624c5) has not established main parity. See the [experiment overview](../docs/rust-port/README.md), [source map](../docs/rust-port/source-map.json), and [upstream reconciliation ledger](../docs/rust-port/upstream-changes.md).

| Directory | Contents |
| --- | --- |
| `tiny-hypergraph` | Main and poly hypergraph dependency ports |
| `high-density-a01` | A01/A03 solver family from the high-density-a01 dependency |
| `intra-node-routing` | General and specialized repository intra-node solvers |
| `drc` | DRC evaluation and geometry |
| `repair` | Repair solvers and Pipeline9 evaluation helpers |
| `trace-simplification` | Trace simplification solvers and shared route state |
| `trace-contiguity` | Reference trace continuity checking |
| `connectivity-map` | SimpleRouteJson connectivity construction |
| `uniform-port-distribution` | Port distribution construction, stepping and rebuild |
| `length-matching` | Obstacle connectivity expansion; the length solver remains TS |
| `autorouter-bindings` | Combined JavaScript exports and source-corresponding orchestration |
| `tiny-hypergraph-bindings` | Hypergraph JavaScript exports and adapter |
| `module-allocator` | Allocation implementation used independently by each compiled module |

In `autorouter-bindings`, `src/ported/` mirrors the source paths of orchestration algorithms and `src/bindings/` holds boundary exports. Existing mixed exports remain in the crate root. TypeScript compatibility support lives in `lib/bindings/`; public source solver classes remain in `lib/solvers/`. The private binding packages retain their own `ts/` adapters.

The compatibility adapters preserve the TypeScript lifecycle, mutable diagnostic state, object identity, and callbacks. They are handwritten support around generated bindings. Source solver names do not gain implementation prefixes; use module-qualified names when a wrapper and its binding share a name. `NativeObstacleTree` is retained because it is already an upstream name.

From the repository root, `bun run build:bindings` builds both modules and embeds their binaries. `bun run build:ts` builds the package and declarations; `bun run build` performs both. The pinned `wasm-bindgen-cli` version is 0.2.128. Set `WASM_BINDGEN` to select an already installed matching executable. No runtime backend selection or asynchronous initialization is needed for ordinary package use.

See [migration validation](../docs/rust-port/validation.md) for checks performed and known pre-existing failures. The naming migration does not claim full behavioral parity with newly pinned main.
