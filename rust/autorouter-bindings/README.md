# Autorouter bindings

Typed adapters for fresh, direct file-by-file Rust ports of A01/A03, the general and specialized intra-node routers, high-density orchestration, DRC evaluation, and repair. The autorouter uses these Rust implementations directly. There are no runtime backend-selection flags or required enable calls.

The published autorouter embeds both WASM modules in its JavaScript bundle. Solver construction initializes the required module synchronously once per JavaScript realm, without fetching an asset or reading a filesystem. The public solver lifecycle remains synchronous. `PortfolioSingleIntraNodeSolver` exposes its results through `solvedRoutes`.

Both WASM modules use the [shared WASM allocator](../module-allocator/README.md), with 8 MiB growth granularity to reduce memory-growth and JavaScript GC pressure. Each module reuses its own freed allocations. The allocator supports single-threaded WASM only and rejects atomics builds; the linked notes describe retained-memory and allocation-failure tradeoffs. This does not change routing algorithms or public APIs.

## Build

From the repository root, with `wasm32-unknown-unknown` installed and `wasm-bindgen-cli` 0.2.128 available:

```sh
bun run build
```

This builds both Rust modules, regenerates bindings, embeds the binaries, and builds JavaScript and declarations. `bun run build:ts` only rebuilds JavaScript/declarations and requires current generated WASM files. Set `WASM_BINDGEN` to select the CLI executable. Generated bindings, embedded modules, and adapter output are ignored by Git.

The standalone private adapter package also supports explicit initialization:

```sh
npm ci --prefix rust/autorouter-bindings --ignore-scripts
npm run build --prefix rust/autorouter-bindings
npm test --prefix rust/autorouter-bindings
```

For that low-level package, call `loadAutorouterBindings({ module_or_path: wasmBytes })` before constructing `HighDensitySolverAdapter("a01", props)` or `HighDensitySolverAdapter("a03", props)`. This initialization API is separate from ordinary autorouter use. Call `dispose()` when finished with a standalone adapter.

## Solver state and boundaries

High-density search state and portfolio scheduling stay in Rust, including each selected candidate's 100-step inner loop. The TS adapter preserves candidate objects, cache storage, and output processing. General-router candidates share a lazy native context so fixed node geometry and connection metadata cross once per portfolio. Each candidate then supplies its hyperparameters. Cache misses construct the routing engine; cache hits retain the existing caller behavior.

General-router child constructors take typed options directly. Obstacle routes and future connections are copied once into each child's snapshot without conversion through JSON values. Public constructors consume their owned input values when decoding them. Optimized polyline steps move completed or discarded candidates into `lastCandidate`; a continuing candidate needs one copy for the queue, preserving diagnostic identities.

Cache key normalization, ordered `object-hash` serialization, and SHA-1 run in Rust. The TS adapter transfers the current cache inputs on each call, preserving live connectivity and public field mutations. Cache schema 4, property order, numeric strings, and UTF-8 replacement semantics remain unchanged, including explicit undefined/null and exceptional numbers. Cache storage remains in TS.

Coordinate normalization captures its inputs before connectivity callbacks; final key fields are read afterward, matching the source when callbacks mutate the solver. Lone-surrogate strings use chunked UTF-16 construction during locale comparison so long IDs do not exceed the host's argument limit.

The native supervisor mirrors candidate order, budgets, scoring, and adaptive expansion. General, specialized, and polyline candidates execute directly in Rust. Route output revisions preserve geometry updates even when a remove-and-replace operation leaves the route count unchanged.

`HighDensitySolver` and `GrowShrinkHighDensityIntraNodeSolver` keep their node order, growth attempts, child lifecycle, route assembly, metadata, and visualization in corresponding files under `src/ported/solvers/`. `src/bindings/high_density_orchestration.rs` connects them to shared native portfolio instances. Their TS classes expose the existing one-step lifecycle and diagnostic objects; `solve()` runs the orchestration loop in Rust. Cache providers, explicit validators, and explicitly supplied custom children keep their TS callback boundaries. `PortfolioCallbackScope` provides callback ownership during native calls without retaining completed children through Rust-to-JS cycles.

Pipeline 9 uses the Rust DRC engine and repair portfolio directly. Candidate generation, scoring, indexed evaluation, and selection remain native throughout that loop. Required reference validation callbacks and post-portfolio validation remain at their existing TS boundaries. The broad-repulsion and targeted-repair adapters also initialize automatically at their existing call sites. See [DRC scope](../drc/README.md) and [repair scope](../repair/README.md).

Host math callbacks preserve JS rounding where native libm would change heap ties: the general router uses host `Math.pow`/`Math.exp`, and A03 uses host `Math.hypot`.

## Reference checks and measurements

Comparisons use a separate frozen TypeScript checkout with its own installed dependencies. Set its absolute path before running comparison harnesses; the reference must not resolve back into this production checkout. Reference code is never imported by the production package.

```sh
export TSCIRCUIT_TS_REFERENCE=/absolute/path/to/frozen-ts-checkout
bun rust/autorouter-bindings/integration/general-parity.ts
bun rust/autorouter-bindings/integration/general-context-parity.ts
bun rust/autorouter-bindings/integration/general-single-input-parity.ts
bun rust/autorouter-bindings/integration/cache-key-parity.ts
bun rust/autorouter-bindings/integration/native-portfolio-parity.ts
bun rust/autorouter-bindings/integration/native-portfolio-reroute-parity.ts
bun rust/autorouter-bindings/integration/orchestration-parity.ts
bun rust/autorouter-bindings/integration/orchestration-general-child-parity.ts
bun rust/autorouter-bindings/integration/orchestration-cached-child-parity.ts
bun rust/autorouter-bindings/integration/orchestration-parent-validator-parity.ts
bun rust/autorouter-bindings/integration/orchestration-resource-lifetime.ts
bun rust/autorouter-bindings/integration/grow-shrink-validator-parity.ts
bun rust/autorouter-bindings/integration/specialized-candidate-identity-parity.ts
bun rust/autorouter-bindings/integration/repair-loop-parity.ts 8
bun rust/autorouter-bindings/integration/parity.ts 16
```

Failure propagation checks include `native-portfolio-callback-error.ts` and `repair-loop-reference-error.ts`. Parity checks compare state, ordering, route bytes, and relevant identity/cache behavior; they do not establish universal equivalence or a speedup.

`specialized-simple-parity.ts` accepts an optional captured-fixture directory as its first argument; that directory must contain `manifest.json`. `trace-contiguity-parity.ts` accepts an optional directory of numbered routed-trace JSON files. Without it, the SRJ18 corpus uses original inputs. Neither harness depends on machine-local capture directories. A `trace-via-parity.ts` mismatch writes actual/expected artifacts to a new system temporary directory and reports its path.

Run the production benchmark without backend flags:

```sh
./benchmark.sh --dataset srj18 --concurrency 4 --sample-timeout 600s
```

A matched comparison runs the frozen TS checkout separately with the same dataset, effort, concurrency, and machine conditions. `integration/timing.ts` provides instrumented candidate diagnostics using the frozen reference; its board times include instrumentation. Use matched whole-board runs to quantify the effect of a port; candidate timings alone do not establish a whole-board speedup.

Set `BENCHMARK_TRACE_DIR=/absolute/path/to/run/traces` when benchmarking to capture the successful route JSON after timed solving. Save that run's benchmark report as `/absolute/path/to/run/result.json`. Capture both the frozen reference and current runs, then compare them with:

```sh
bun scripts/benchmark/compare-exact-results.ts /absolute/path/to/reference-run /absolute/path/to/current-run
```

The comparison requires the same dataset, effort, solver, and samples. It checks route files byte for byte, including property order and numeric serialization, and requires identical failure messages, DRC diagnostics, and routing work counters. It prints per-board and aggregate timings only after those checks pass. Timing and backend labels are excluded from equality checks. Trace capture supports one solver per run; match concurrency, timeout, and machine conditions separately.
