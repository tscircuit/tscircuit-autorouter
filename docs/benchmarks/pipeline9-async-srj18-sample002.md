# Pipeline9 async high-density benchmark

Pipeline9 now supports `await solver.solveAsync({ workerCount: 8 })`. It prefers Bun's Web Workers and uses Node's `worker_threads` otherwise. Synchronous `.step()` and `.solve()` retain their existing execution model.

## Dataset-srj18 sample002

Single full-pipeline runs on an Apple M3 Pro, 12 logical CPUs, macOS arm64, at effort 1 with `cacheProvider: null`. The checkout is based on `9d95bfdde15f739bdb362d38a01f7f6ac2c63450`; the dataset dependency is pinned to `100e8957ce789b5b288e14c476dc83f4efc5214b`. Sample002 produces 751 high-density nodes and no preloaded high-density routes.

Each synchronous/async pair ran in separate processes, sequentially on the same machine. Worker startup, input serialization, routing, result collection, and shutdown are included. These are individual measurements, not statistical aggregates. The Bun pair uses repository source; the Node pair uses the built package.

| Runtime | Workers | Synchronous total | Async total | Overall saving | Synchronous high density | Async high density |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Bun 1.3.2 | 8 | 71.335s | 57.067s | **14.268s (20.0%)** | 26.062s | 13.390s |
| Node 26.4.0 | 4 | 93.395s | 71.001s | **22.394s (24.0%)** | 32.755s | 13.553s |

Both runtime pairs have byte-identical complete output JSON (`cmp`), including route ordering. The Bun pair also has identical high-density iteration counts (387,522) and full-pipeline iteration counts (1,267,985).

- Bun output SHA-256: `ee552ee5dc3ee48eb104404b9c289ba056de8fa62af760a408450429e4fdd85b`
- Node output SHA-256: `1412f3b6fb6229593cd39135c4f77b2db3208ce202146c4084af0e641e461220`

Equality is checked against the synchronous baseline on each runtime. The source Bun and built Node baselines differ, so equality is reported within each runtime/build pair.

Raw per-phase timings are in [pipeline9-async-srj18-sample002.json](./pipeline9-async-srj18-sample002.json).

## Reproduction

Run each command to completion before starting the next timing run:

```sh
bun install
bun scripts/benchmark/pipeline9-async.ts sync 8 /tmp/pipeline9-bun
bun scripts/benchmark/pipeline9-async.ts async 8 /tmp/pipeline9-bun
cmp /tmp/pipeline9-bun/sync.json /tmp/pipeline9-bun/async.json

bun run build
node scripts/benchmark/pipeline9-async.ts sync 4 /tmp/pipeline9-node built
node scripts/benchmark/pipeline9-async.ts async 4 /tmp/pipeline9-node built
cmp /tmp/pipeline9-node/sync.json /tmp/pipeline9-node/async.json
```

The Node commands require a Node version supporting TypeScript stripping (the measured version is 26.4.0). The benchmark script records output JSON, SHA-256, logical iteration counts, and every phase's elapsed time. Blacksmith startup was blocked by this session's filesystem permissions, so these are local measurements.

## Execution and validation

Workers receive immutable routing context once, then dynamically consume four-node jobs. Each worker invokes the existing high-density solver and returns routes, logical work counts, and statistics. Results are committed in original node-pop order, independent of worker count or completion order. An iteration limit crossing a job is enforced with the original synchronous steps so no routes beyond that limit are published. Workers terminate in `finally`, including on errors.

Preloaded copper repairs can change obstacles for subsequent nodes; those inputs keep their ordered synchronous execution. Hosts without a Bun/Node runtime also use the synchronous implementation. Shared memory is unnecessary for independent solver state; input context is cloned once per worker. Default worker count is half the available parallelism, capped at eight.

Validation completed:

- `bun run build`, including declaration generation and the packaged worker entry.
- Eight focused tests (139 assertions): full-pipeline output and iteration equivalence, 1/2/4 worker equivalence, partial-step resumption, empty input, invalid worker count, iteration budgets, routing failure propagation, ordered preloads, terminal IDs, and existing high-density behavior.
- Built-package smoke checks under both Node 26.4.0 and Bun 1.3.2: synchronous/async complete output and logical iteration equality.
- Full sample002 synchronous/async output comparisons under both runtimes.
- Repository-wide `tsc --noEmit` reports the same pre-existing diagnostics on the unmodified base and this branch after normalizing dependency paths; no new diagnostics.

## Shipping through core

`@tscircuit/core` declares `@tscircuit/capacity-autorouter` as a peer dependency and its current tsup configuration keeps it external. The installed autorouter package therefore owns the worker, Node runtime loader, and shared chunks together under `dist/`. The build emits both `pipeline9HighDensityWorker.js` and `pipeline9NodeRuntime.js`; the published `files: ["dist"]` includes both.

Node builtins live in the separate runtime asset, loaded by URL only after detecting a Bun/Node host. This prevents browser bundlers from resolving `node:os` and `node:worker_threads` when bundling the Pipeline9 class. In a browser, `solveAsync()` uses the existing synchronous algorithm.

Reproduce the shipping checks with:

```sh
bun run build --clean
bun scripts/check-async-packaging.ts
```

The check packs an actual npm tarball, checks both runtime assets, extracts it into an isolated consumer without source-checkout links, and verifies exact synchronous/async output and logical iteration equality on Node and Bun. It also bundles that installed package for a browser and executes `solveAsync()` with browser globals and no Node process.

Node/Bun consumers that inline the autorouter into another bundle must preserve its runtime assets at their expected relative paths, or keep the autorouter external as core currently does. Arbitrary single-file bundling is not supported automatically.

Core currently drives Pipeline9 with `step()` (or `stepAsync()` on solvers that expose it), so updating the package alone does not activate worker routing. Its adapter still needs to invoke the async path to receive the measured speedup.
