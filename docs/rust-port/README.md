# Rust experiment

This branch moves selected autorouter computations into Rust/WASM while keeping
the existing synchronous TypeScript solver API. Ports follow the source files,
solver names, function structure and arithmetic. Ordinary callers use embedded
WASM automatically; the separate TS reference checkout is only for development
comparisons.

## Scope

The main Pipeline9 path uses native hypergraph search, high-density routing
engines and orchestration, trace simplification, Uniform port distribution,
selected repair engines, connectivity construction and reference continuity/
via-clearance checks. The [crate inventory](../../rust/README.md) and
[source correspondence](source-map.json) identify their locations and origins.

Substantial TS remains: preparation and topology, outer pipeline integration,
remaining repair passes, stitching, trace width, actual length matching,
power expansion, visualization and alternative pipelines. Compatibility
adapters retain mutable aliases, callbacks, stepping and diagnostic objects.
The presence of a Rust counterpart does not imply every caller has migrated.

## Build and validate

CI uses Rust 1.98.1, the `wasm32-unknown-unknown` target, and wasm-bindgen-cli
0.2.128. With those tools installed, run from the repository root:

```sh
bun install
bun run build
bunx tsc --noEmit
bun test tests/wasm-via-trace-clearance-parity.test.ts --timeout 9999999
```

`bun run build` builds both native modules, generates their JS bindings, embeds
the WASM bytes, and builds the package and declarations. `build:bindings` and
`build:ts` run the respective parts. Generated files and compiler output are
ignored by Git; a fresh checkout needs the binding build before source imports.
`WASM_BINDGEN` can select an already installed matching CLI executable.

Frozen-reference harnesses require `TSCIRCUIT_TS_REFERENCE` to point to a separate
checkout with its own dependencies. See the [binding guide](../../rust/autorouter-bindings/README.md)
for commands and optional captured-fixture inputs. Tests never select a TS
backend in production.

## Measurements and parity

The recorded regression oracle is commit `22800e78` with retained local changes.
Its results are distinct from the [upstream-main reconciliation](upstream-changes.md)
at `109c67b`; parity against that newer main has not been established.

- [Matched SRJ18 comparison](performance.md): conservative 1.51x whole-board
  speedup across the same 13 successful boards, with matching outcomes on all
  16 and byte-identical successful traces. Both arms used four workers.
- [Committed timing data](measurements/srj18-matched.json): per-board results from
  both matched comparisons, without machine-local artifact dependencies.
- [Long-board profiles](long-board-profile.md): measured stage and boundary
  budgets for boards 2, 12 and 13.
- [Reference clearance pass](reference-via-clearance.md): 3.1–4.6x faster isolated
  check; the small whole-board difference is indicative, not a matched new
  Rust-versus-TS headline.
- [Uniform and repair completion](module-completion.md): exact scope and the
  measured cost of preserving the remaining public behavior.

For a new comparison, run each checkout sequentially with the same dataset,
effort, concurrency and timeout. Capture traces with `BENCHMARK_TRACE_DIR` and
compare the runs using `scripts/benchmark/compare-exact-results.ts`.

## Cleanup and remaining work

The experiment cleanup removed ten unused TS geometry/via helpers (1,170 lines)
and unused facade imports. Two earlier candidates remain because a test and a
debugger fixture use them. Parity harnesses now accept optional capture paths
instead of relying on machine-specific temporary directories. A WASM-only
Uniform binding is correctly excluded from native builds.

The [cleanup validation](cleanup-validation.md) records checks for the prepared
branch. Earlier [naming validation](validation.md), [naming plan](cleanup-plan.md)
and [TS inventory](typescript-inventory.md) are historical snapshots.

Before claiming upstream readiness, resolve the remaining source-provenance
entries, reconcile newer-main behavior and run the complete CI test matrix.
Performance work should continue to preserve exact outputs, source likeness
and the TS interface.
