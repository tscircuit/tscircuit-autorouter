# tiny-hypergraph WASM adapter

A typed TypeScript adapter around the Rust `TinyHyperGraphSolver`. The graph,
queues, and routing state live in Rust for the lifetime of each solver instance.
This package is private and does not yet replace autorouter imports.

## Build and test

From the repository root:

```sh
npm ci --prefix rust/tiny-hypergraph-wasm --ignore-scripts
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.128 --locked
npm run build --prefix rust/tiny-hypergraph-wasm
npm run typecheck --prefix rust/tiny-hypergraph-wasm
npm test --prefix rust/tiny-hypergraph-wasm
```

The WASM build checks that the CLI version matches Cargo.lock. Set `WASM_BINDGEN`
to use an alternate executable without changing the global installation.
`build:wasm` regenerates the bindings in `pkg/`; `build:adapter` compiles the
TypeScript in `ts/` to ESM and declarations in `dist/`. Both output directories
are ignored by Git and included in the package's file list.

For Bun, run from this package so the autorouter's graphics preload is not used:

```sh
cd rust/tiny-hypergraph-wasm
bun test --timeout 9999999
```

## TypeScript interface

Initialize once, then construct and use solvers synchronously. In Node or Bun,
supply the WASM bytes using the exported asset path:

```ts
import { readFile } from "node:fs/promises"
import {
  initTinyHypergraphWasm,
  TinyHyperGraphSolver,
  type TinyHyperGraphTopology,
  type TinyHyperGraphProblem,
} from "@tscircuit/tiny-hypergraph-wasm"

const bytes = await readFile(new URL(
  import.meta.resolve("@tscircuit/tiny-hypergraph-wasm/wasm"),
))
await initTinyHypergraphWasm(bytes)

function route(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem) {
  const solver = new TinyHyperGraphSolver(topology, problem, { MAX_ITERATIONS: 100_000 })
  try {
    while (!solver.solved && !solver.failed) {
      solver.stepMany(1000)
    }
    if (solver.failed) throw new Error(solver.error ?? "Routing failed")
    return solver.getOutput()
  } finally {
    solver.dispose()
  }
}
```

Browser hosts can supply a deployed asset URL to `initTinyHypergraphWasm`.
Calling it without an argument uses the generated binding's default asset URL.
Concurrent calls share the first in-flight initialization, and successful
initialization is reused. After a failed load, a later explicit call can retry.
Constructing a solver before initialization finishes throws a descriptive error.
Browser asset copying and bundler integration remain untested.

The constructor accepts numeric topology/problem shapes with camelCase fields.
JS typed arrays and regular numeric arrays are accepted and copied into Rust
vectors. Metadata must be serializable by serde-wasm-bindgen into JSON values.
Options retain their uppercase keys, such as `MAX_ITERATIONS`.

- `step()` advances one algorithm iteration, handling setup first.
- `stepMany(maxSteps)` batches a positive integer count and stops on completion,
  failure, or the solver's iteration limit. Its argument does not change the
  solver's total iteration budget.
- `solve()` runs synchronously until completion or failure.
- `solved`, `failed`, `error`, `iterations`, `pendingRouteCount`, and `ripCount`
  reflect the latest observed Rust status. They are refreshed by stepping,
  solving, or `getStatus()`. Assigning these TS fields does not configure Rust.
- `getStatus()` returns a fresh typed status object and normalizes an absent
  error to `null`. Stepping returns the same status shape.
- `getRoutingSnapshot()` explicitly copies assignments, region segments,
  current route ID, and unrouted route IDs into JS arrays. Changing the snapshot
  does not change Rust state.
- `getStats()` returns `Record<string, unknown>`; callers narrow individual stats.
- `getOutput()` returns the existing `SerializedHyperGraph` type and requires a
  solved, non-failed solver.
- `visualize()` and `preview()` return the existing `GraphicsObject` type.
- `dispose()` releases the Rust instance and is idempotent. Further methods
  throw a descriptive error; scalar status fields retain their last values.

The adapter does not extend `BaseSolver`: it preserves the Rust iteration count
instead of adding another counter around each batch. It does not yet expose the
full mutable TS `state`, `topology`, or `problem` objects, subclass hooks, pipeline
stages, or progress semantics. Those are integration work for the autorouter.
No JS callback is used in the Rust search loop.

The raw generated bindings remain an implementation detail in `pkg/`, where
`RustTinyHyperGraphSolver` supplies the lower-level interface and `free()`.
Type assertions are confined to the adapter's return boundary; exported methods
and declarations do not expose those generated `any` return types. Compile-only
contract tests check the public package exports with strict TypeScript settings.

## Scope and validation

Five tests pass in Node and Bun: adapter initialization/lifecycle, raw single-
step/batched/full-solve agreement, iteration limits, isolated ownership/disposal,
and input/method errors. They exercise a small deterministic route, not full
TypeScript/Rust behavior parity. Native checking and the release WASM build pass
with the core's existing four dead-code warnings.

Input deserialization and invalid method requests return JS Errors. Internal
invariants retain the core's fail-loud behavior and may trap. Neither adapter
nor binding suppresses solver failures.

Output follows the existing core serializer: arbitrary route metadata is not
included in serialized connections. Port/region metadata is preserved according
to that serializer's existing behavior.

Next work: serialized-graph loading, solver variants, and the autorouter's
reservation/preloaded-route policies. Section pipelines are not exported yet;
expected candidate rejection must use explicit error handling in place of
`catch_unwind` before exposing them on the default WASM target.
