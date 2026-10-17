# Pipeline 9 joint DRC repair with eight workers

The supplied debugger input contains 244 routed connections and 407 obstacles.
On a Blacksmith 4-vCPU ARM64 runner with Bun 1.4.3, the eight-worker path is
4.1 times faster than upstream `9d95bfdde`. Both outputs pass full reference
DRC with trace continuity and board clearance enabled.

The raw measurements, per-phase times, route hashes, and solver statistics are
in [pipeline9-joint-drc-eight-workers.json](pipeline9-joint-drc-eight-workers.json).
Every trial starts a fresh process and includes solver construction and worker
startup. Input parsing and worker shutdown are excluded for both paths.

| Measurement | Original | Eight workers |
| --- | ---: | ---: |
| Median solve time | 52.81 s | 12.99 s |
| Reference DRC errors | 0 | 0 |
| Routed connections | 244 | 244 |
| Vias | 542 | 544 |
| Trace length | 4754.66 mm | 4779.38 mm |

Equivalent quality permits different coordinates. Tests verify connection order,
endpoint coordinates/layers, trace widths, via diameters, full reference DRC, and
identical output on repeated runs. These measurements cover this input, rather
than a claim about every board.

## How it works

When a repair runtime is supplied, the joint solver first attempts bounded
regional negotiation. Each region searches a fixed portfolio of weighted A*
settings in parallel. The node and search-call budgets are divided across the
workers; their actual work is summed. Candidates are selected by unresolved
span count and trace length, with input order breaking ties. Worker completion
time never changes the result.

Candidate search defers continuity and board-edge checks until a candidate is
otherwise clean. Full reference DRC, including both checks, must accept a board
before the joint solver publishes it. If the bounded search cannot produce a
clean board, the existing serial repair stages run from their original input.
Worker exceptions propagate; they never trigger successful publication.

The runtime is optional and reusable. Without it, existing serial behavior is
preserved. Both `step()` and `solve()` stay synchronous and deterministic.

## Use

```ts
import { Pipeline9JointDrcRepairSolver } from "@tscircuit/capacity-autorouter"
import { NodePipeline9RepairRuntime } from "@tscircuit/capacity-autorouter/dist/parallel-repair/NodePipeline9RepairRuntime.js"

const repairRuntime = new NodePipeline9RepairRuntime(8)
try {
  const solver = new Pipeline9JointDrcRepairSolver({ ...params, repairRuntime })
  solver.solve()
  if (solver.failed) throw new Error(solver.error ?? "Joint repair failed")
  const routes = solver.getOutput()
} finally {
  await repairRuntime.dispose()
}
```

The full Pipeline 9 constructor also accepts `{ repairRuntime }` in its options.
The Node runtime is a separate build entry so browser consumers do not import
`node:worker_threads`.

## Reproduce

Run the original path and the worker path separately on the same machine:

```sh
bun scripts/benchmark/joint-drc-workers.ts tests/fixtures/pipeline9-joint-drc-parallel-input.json.gz 0 baseline
bun scripts/benchmark/joint-drc-workers.ts tests/fixtures/pipeline9-joint-drc-parallel-input.json.gz 8 parallel
```

The benchmark restores the debugger export's shared `$ref` objects, connectivity
map, and mutated-trace set before constructing the solver.
