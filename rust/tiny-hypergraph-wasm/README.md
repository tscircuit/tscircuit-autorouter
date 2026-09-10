# tiny-hypergraph WASM adapter

A typed TypeScript adapter around the Rust `TinyHyperGraphSolver`. The graph,
queues, and routing state live in Rust for the lifetime of each solver instance.
This package is private. The autorouter can opt into Rust graph loading and
main routing through the benchmark switch below; TypeScript remains the default.

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

## srj18 benchmark

After building this package and installing the root dependencies:

```sh
./benchmark.sh --dataset srj18 --tiny-hypergraph-backend wasm --concurrency 4
```

For a one-sample smoke run:

```sh
./benchmark.sh --dataset srj18 --tiny-hypergraph-backend wasm \
  --limit 1 --concurrency 1 --sample-timeout 60s
```

The benchmark initializes WASM once per worker before timing the solve. Results
include `routingMetrics.tinyHypergraph.backend` so Rust runs can be identified.
The default pipeline 9 uses Rust loading and selective reripping, including
restoration of preloaded assignments on global retries and preference for other
blockers during selective reripping. Terminal reservations, metadata penalties,
and preloaded endpoint policies run in the existing TS helpers before the graph
is copied into Rust. The trace-density portfolio also uses Rust when selected.

The port-duplication prepass still runs in TypeScript. The main autorouter's
section mask is empty. The bridge preserves its solved-graph replay, including
route ordering and segment direction, without doing section optimization.
Section optimization, poly routing, and bus routing are not switched over.
This is a source-tree benchmark integration, not published browser packaging.

The srj18 parity test compares every sample's port-pathing output and search
iteration count against TS, including failed samples. The end-to-end benchmark
completes 13/16 samples with relaxed DRC passing, matching TS. Samples 14 and 15
retain their routing-limit failures; sample 6 reproduces TS's downstream
`repair04` non-colocated-via error when run alone.
These are correctness checks, not a controlled speed comparison.

Run the isolated srj18 port-pathing integration tests from this package
(with the root autorouter dependencies installed):

```sh
cd rust/tiny-hypergraph-wasm
bun test --timeout 9999999 integration/srj18.test.ts
bun test --timeout 9999999 integration/parity.test.ts
bunx tsc -p tsconfig.integration.json
cargo test
cargo test --manifest-path ../tiny-hypergraph/Cargo.toml
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
Options retain their uppercase keys, such as `MAX_ITERATIONS` and
`TRACE_DENSITY_COST_FACTOR`. An optional fourth constructor argument selects
`{ variant: "base" | "outside-in" | "selective-rerip",
preserveInitialAssignments?: boolean }`. The default variant is `base`.
`preserveInitialAssignments` restores initial occupancy on global retries and,
for selective reripping, prefers blockers outside those preloaded routes.

For the autorouter's serialized graph format, load through Rust first:

```ts
import { loadSerializedHyperGraph, TinyHyperGraphSolver } from "@tscircuit/tiny-hypergraph-wasm"

// After awaiting initTinyHypergraphWasm(...):
const { topology, problem, solution } = loadSerializedHyperGraph(serializedGraph)
const solver = new TinyHyperGraphSolver(topology, problem)
try {
  solver.solve()
  if (solver.failed) throw new Error(solver.error ?? "Routing failed")
  const routedGraph = solver.getOutput()
} finally {
  solver.dispose()
}
```

`loadSerializedHyperGraph` returns independent JS arrays containing numeric IDs,
geometry, net IDs, port penalties, initial assignments, and existing solution
segments. The `solution` describes serialized solved routes; initial occupancy
comes from region assignments in `problem.initialAssignments`. The loader keeps
the Rust implementation's obstacle filtering and directly connected route rules.
Metadata survives loading, including terminal reservation and preloaded trace
metadata. The autorouter bridge applies its policies to this loaded input before
constructing a solver; loading alone does not apply them.

- `step()` advances one algorithm iteration, handling setup first.
- `stepMany(maxSteps)` batches a positive integer count and stops on completion,
  failure, or the solver's iteration limit. Its argument does not change the
  solver's total iteration budget.
- `solve()` runs synchronously until completion or failure.
- `replaySolution(solution)` validates and rebuilds complete solved routes in
  route order and start-to-end direction, without running a search. It resets
  the solver to the replayed solved state and returns its status.
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

Nine package tests pass in Node and Bun: adapter initialization/lifecycle, raw single-
step/batched/full-solve agreement, iteration limits, isolated ownership/disposal,
input/method errors, and serialized-graph loading/routing with preloaded
assignments, variant dispatch, timeout acceptance, and solution replay. Four
native tests cover retry preservation, owner-cycle detection, quality-rerip
preservation, and trace-density costs. Isolated Bun integration tests exercise
pipeline 9 and compare its TS/WASM port-pathing results on srj18. These checks
do not establish universal
TypeScript/Rust behavior parity. Native checking and the release WASM build pass
with the core's existing four dead-code warnings.

Input deserialization and invalid method requests return JS Errors. Internal
invariants retain the core's fail-loud behavior and may trap. Neither adapter
nor binding suppresses solver failures.

Output follows the existing core serializer: arbitrary route metadata is not
included in serialized connections. Port/region metadata is preserved according
to that serializer's existing behavior.

Next work: broader srj18 parity checks and replacing the TS duplication prepass.
Section pipelines are not exported yet;
expected candidate rejection must use explicit error handling in place of
`catch_unwind` before exposing them on the default WASM target.
