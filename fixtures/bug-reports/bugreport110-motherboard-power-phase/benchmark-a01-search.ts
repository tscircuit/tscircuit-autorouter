import { createHash } from "node:crypto"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import workload from "./a01-search-workload.json"

// Bounded A01 searches captured from the motherboard's high-density phase.
// These include unsuccessful attempts; their budget and outcome must match too.
const batchSize: number = Number(process.env.A01_BATCH_SIZE ?? 0)
if (!Number.isSafeInteger(batchSize) || batchSize < 0) {
  throw new Error("A01_BATCH_SIZE must be a non-negative safe integer")
}
let elapsedMs = 0
const outcomes = []
for (const { props, stepLimit } of workload) {
  const start = performance.now()
  const solver = new HighDensitySolverA01(props)
  solver.setup()
  solver.MAX_ITERATIONS = stepLimit
  if (batchSize > 0) {
    while (!solver.solved && !solver.failed) solver.stepBatch(batchSize)
  } else {
    solver.solve()
  }
  elapsedMs += performance.now() - start
  outcomes.push({
    solved: solver.solved,
    failed: solver.failed,
    iterations: solver.iterations,
    routes: solver.getOutput(),
  })
}
console.log(
  JSON.stringify({
    elapsedMs,
    batchSize,
    cases: outcomes.length,
    iterations: outcomes.reduce((sum, outcome) => sum + outcome.iterations, 0),
    outputHash: createHash("sha256")
      .update(JSON.stringify(outcomes))
      .digest("hex"),
    peakRss: process.resourceUsage().maxRSS,
    bunVersion: Bun.version,
  }),
)
