# tiny-hypergraph WASM bindings

An initial JavaScript-callable wrapper around the core `TinyHyperGraphSolver`.
The solver, graph, and search state live in Rust for the lifetime of the instance.
This package is private and does not yet replace autorouter imports.

## Build and test

From the repository root:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.128 --locked
node rust/tiny-hypergraph-wasm/scripts/build.mjs
node --test rust/tiny-hypergraph-wasm/tests/*.test.mjs
```

The build checks that the installed CLI matches Cargo.lock. Set `WASM_BINDGEN`
to use an alternate executable without changing the global installation.
Generated JS, TypeScript declarations, and WASM live in the ignored `pkg/`
directory. The release build is locked to the checked-in dependencies.

For Bun, run from this package so the autorouter's graphics preload is not used:

```sh
cd rust/tiny-hypergraph-wasm
bun test --timeout 9999999
```

## JavaScript interface

The generated module uses wasm-bindgen's `web` ESM target with explicit one-time
initialization. Node and Bun can supply bytes:

```js
import { readFile } from "node:fs/promises"
import init, { RustTinyHyperGraphSolver } from "./pkg/tiny_hypergraph_wasm.js"

const bytes = await readFile(new URL("./pkg/tiny_hypergraph_wasm_bg.wasm", import.meta.url))
await init({ module_or_path: bytes })

const solver = new RustTinyHyperGraphSolver(topology, problem, options)
try {
  let status = solver.getStatus()
  while (!status.solved && !status.failed) {
    status = solver.stepMany(1000)
  }
  if (status.failed) throw new Error(status.error)
  const graph = solver.getOutput()
} finally {
  solver.free()
}
```

Browser hosts can pass the deployed WASM asset URL to `init`. Asset copying and
browser integration have not yet been exercised in the autorouter build.

The constructor accepts the existing numeric topology/problem shapes with
camelCase fields. JS typed arrays are accepted and copied into Rust vectors.
Options use the existing uppercase solver keys such as `MAX_ITERATIONS`.

- `step()` advances one algorithm iteration, handling setup first.
- `stepMany(maxSteps)` batches a positive integer number of iterations and stops
  on completion, failure, or the solver's iteration limit.
- `solve()` runs synchronously until completion or failure.
- `getStatus()` returns solved/failed flags, error, iterations, pending route
  count, and rip count. No graph or candidate queue is copied during stepping.
- `getRoutingSnapshot()` explicitly copies assignments, region segments,
  current route ID, and unrouted route IDs into JS arrays.
- `getStats()`, `getOutput()`, and `visualize()` return plain JS objects.
- `free()` releases the Rust instance; do not use it afterwards.

Optional fields such as a missing error serialize as `undefined`. Snapshots are
owned copies: modifying one does not mutate the solver. Input deserialization
and invalid method requests return JS Errors. Solver-internal invariants retain
the core's fail-loud behavior and may trap; the binding does not swallow them.

The output follows the existing core serializer's schema; arbitrary route
metadata is not included in serialized connections. Port/region metadata is
preserved according to that serializer's existing behavior.

## Scope and validation

Four smoke tests pass in Node and Bun: single-step/batched/full-solve agreement,
iteration limits, isolated ownership/disposal, and input/method errors. They
exercise a small deterministic route, not full TypeScript/Rust behavior parity.
Native checking and the release WASM build pass with the core's existing four
dead-code warnings.

Next work: a typed TS adapter, serialized-graph loading, solver variants, and the
autorouter-specific reservation/preloaded-route policies. Section pipelines are
not exported yet; their candidate rejection currently relies on `catch_unwind`,
which must be replaced with explicit error handling for the default WASM target.
