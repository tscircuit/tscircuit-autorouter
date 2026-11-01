import { createHash } from "node:crypto"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import workload from "./a01-search-workload.json"

// Bounded A01 searches captured from the motherboard's high-density phase.
// These include unsuccessful attempts; their budget and outcome must match too.
let elapsedMs = 0
const outcomes = []
for (const { props, stepLimit } of workload) {
  const start = performance.now()
  const solver = new HighDensitySolverA01(props)
  solver.setup()
  solver.MAX_ITERATIONS = stepLimit
  solver.solve()
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
    cases: outcomes.length,
    iterations: outcomes.reduce((sum, outcome) => sum + outcome.iterations, 0),
    outputHash: createHash("sha256")
      .update(JSON.stringify(outcomes))
      .digest("hex"),
    peakRss: process.resourceUsage().maxRSS,
    bunVersion: Bun.version,
  }),
)
