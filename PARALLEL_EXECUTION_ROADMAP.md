# Parallel execution roadmap

Parallelize Pipeline9's independent high-density work with identical results and safe packaging through core, eval, and CLI. Keep `.step()` and `.solve()` synchronous; `.solveAsync()` orchestrates an injected runtime.

## Starting point

[PR #3116](https://github.com/tscircuit/tscircuit-autorouter/pull/3116) adds `.solveAsync({ workerCount })`, preferring Bun workers and supporting Node `worker_threads`. Results commit in serial order. Preloaded-copper cases stay serial because repairs can change later obstacles; browsers also run serially.

Measured on dataset-srj18 sample002, effort 1, cache disabled:

| Runtime/build | Workers | High density | HD saved | Overall saved |
| --- | ---: | --- | --- | --- |
| Bun 1.3.2, source | 8 | 26.06s → 13.39s | 12.67s (48.6%) | 14.27s |
| Node 26.4, built | 4 | 32.76s → 13.55s | 19.20s (58.6%) | 22.39s |

Individual runs; output was byte-identical within each runtime/build pair. These do not establish 4-versus-8-worker scaling or cross-runtime equality. Retain the ≥10s overall improvement target.

Sibling worker/runtime URLs remain fragile under rebundling. Core still drives `.step()`/`.stepAsync()`, so updating the autorouter alone does not activate parallelism there.

## API and algorithm ownership

`runtime.executeAsync(name, input)` submits **one named task**. A reusable pool queues calls and limits concurrency; each call does not create a thread. An inline runtime calls the same registered function locally. No `runtime.map` API is needed.

Proposed wiring (names are illustrative):

```ts
// algorithms.ts — ordinary imports, not paths to worker entrypoints
import { solveHighDensityNode } from "./tasks/solveHighDensityNode"

export const algorithms = new TscircuitAutorouterAlgorithms()
algorithms.register("pipeline9.highDensityNode", solveHighDensityNode)

// worker.ts — the build bundles this registry and its dependencies
import { algorithms } from "./algorithms"
// Dispatch { taskId, name, input } to algorithms; reply with result or error.

// Pipeline9 — submit independent inputs; commit in original serial order
const pending: Promise<HighDensityOutput>[] = []
for (const input of nodeInputs) {
  pending.push(runtime.executeAsync("pipeline9.highDensityNode", input))
}
const outputs = await Promise.all(pending)
for (const output of outputs) applyOutput(output)
```

Type task names, inputs, and outputs. Both runtimes load the same registry; parent registration alone cannot install worker code. Transfer data, never callbacks/closures; reconstruct domain objects in workers. Initialize context once per worker, batch small jobs, and use shared memory only if profiling justifies it.

The pipeline owns dependencies, deterministic commits, iteration budgets, and solver state; the runtime owns scheduling, transport, cancellation, errors, and disposal. Add independent tasks phase by phase. Reject worker errors without silent serial retries. Preserve resume-after-step and prevent concurrent solver mutation.

## Packaging and repositories

**No new repository is required initially.** Keep the registry, tasks, runtime interface, and adapters in this repository/package (`@tscircuit/capacity-autorouter`):

- Default entry: solvers, types, and inline runtime; no thread payload or Node builtins.
- Optional `/threads` entry: Bun/Node conditional exports, preferring Bun's native Worker API on Bun.
- At package build time, bundle the worker bootstrap, registry, and dependencies into self-contained source, then generate an exported string. Bun launches a Blob URL; Node launches a CommonJS payload with `new Worker(source, { eval: true })`. Revoke Blob URLs and dispose workers appropriately.

Embedding the prebuilt program avoids locating `./worker.js` after rebundling, at the cost of a larger optional bundle. Verify no unresolved relative imports/assets remain, including future WASM. Version the payload/protocol with the package.

### Solver packages such as `tscircuit/tiny-hypergraph`

Each package owns its decomposition and exports typed worker-safe functions through, for example, `/parallel-tasks`. Async solvers accept an executor rather than spawning private pools. The autorouter's registry statically imports these exports into its worker payload:

```ts
import { solveRegion } from "tiny-hypergraph/parallel-tasks" // proposed export
algorithms.register("tiny-hypergraph.solveRegion", solveRegion)
```

Exports identify implementations, not worker paths. Standalone adapters are optional; core/CLI reuse the host pool/budget. Prevent nested-pool deadlocks: decompose at the orchestrator or execute nested work inline. Use structural executor types without depending back on the autorouter. If packages need a shared contract/adapter, create `tscircuit/parallel-runtime` then; domain tasks stay in their owning repositories.

## Integration boundaries

| Consumer | Plan |
| --- | --- |
| `tscircuit/core` | Accept an injected autorouter runtime and pass it to Pipeline9. Default to inline; never import `/threads` automatically. Add async orchestration with progress, previews, cancellation, and event-loop yields before changing the current stepping loop. Preserve debugging and synchronous APIs. |
| `tscircuit/eval` | Already bundles core into a background worker and can embed that worker as a Blob. Instantiate the inline runtime **inside that worker**, using the algorithms already bundled there. Do not embed another autorouter worker payload. One background worker keeps the UI responsive but does not parallelize high-density tasks. |
| `tscircuit/cli` | Explicitly opt into `/threads` where routing runs and inject it into core. Prefer Bun's adapter on Bun, Node's on Node. Share/reuse pools across solves where practical and dispose them on completion, cancellation, or failure. |

Across worker boundaries, send configuration and construct runtimes locally; runtime instances/functions cannot be cloned through Comlink/postMessage. Browser parallelism is a future adapter. Eval's factory terminates the previous global worker and cannot directly create a pool.

The CLI already parallelizes build/snapshot files. Allocate **one CPU budget** across file and routing workers, accounting for active build threads; never assign every file a full-size pool.

## Rollout checklist

- [ ] Land/review the Pipeline9 prototype and retain its serial/async regression fixtures.
- [ ] Implement typed registry, inline runtime, `executeAsync`, and reusable Bun/Node pools; migrate high-density dispatch without changing task algorithms.
- [ ] Define package-owned task exports for solvers such as tiny-hypergraph as they gain parallel phases; aggregate them statically, share the host executor, and test standalone/host parity. Extract a shared contract package only when needed.
- [ ] Add cancellation, progress, bounded queues/batches, deterministic commits, exact iteration-budget behavior, and guaranteed cleanup; preserve serial handling of dependent/preloaded cases.
- [ ] Replace sibling-file loaders with generated embedded payloads and conditional exports. Verify Bun Blob workers and Node CommonJS workers from the published package.
- [ ] Test packed tarballs in isolated Node/Bun consumers, both externalized and rebundled, plus a browser/eval bundle with no Node builtins or embedded threads payload. Check exports, declarations, assets, startup errors, and disposal.
- [ ] Add core runtime injection and async lifecycle integration; coordinate public configuration/types with `@tscircuit/props` if needed.
- [ ] **Add a core parity harness:** render fresh instances of the same circuit with inline and threaded runtimes under the same build, seed, options, and cache conditions; retain legacy synchronous `.solve()` references in autorouter tests. Compare full deterministic Circuit JSON, routed traces/IDs/order, solver status/iterations, connectivity, and DRC outcomes. Exclude only documented nondeterministic metadata such as timing; never normalize away routing differences.
- [ ] Run parity in CI on Bun and Node with 1/4/8 workers, cache disabled and enabled, ordinary/preloaded fixtures, resumed solves, and budget boundaries. Separately assert worker-failure propagation, cancellation, progress, no late completion after stop, and no leaked workers.
- [ ] Wire eval's inline choice inside its existing worker; verify responsiveness, cancellation, and no duplicate worker payload.
- [ ] Wire CLI's explicit threaded choice, shared CPU budget, shutdown, and serial opt-out. Test packed end-to-end single-file builds, parallel multi-file builds, and snapshots on Bun/Node.
- [ ] Repeat sample002 benchmarks at 4 and 8 workers on the same runtime/build and machine, including startup/serialization overhead; publish parity and timing results. Enable CLI defaults only after packaging, parity, lifecycle, and performance gates pass.
