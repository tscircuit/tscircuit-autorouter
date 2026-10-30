import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

const { PowerTraceExpanderSolver } = await import(
  process.env.EXPANDER_MODULE ?? "@tscircuit/power-trace-expander"
)
if (!process.argv[2]) {
  throw new Error("Pass the captured expansion-input.json path")
}
const [input, options] = JSON.parse(readFileSync(process.argv[2], "utf8"))
const start = performance.now()
const solver = new PowerTraceExpanderSolver(input, options)
solver.solve()
const elapsedMs = performance.now() - start
const output = JSON.stringify(solver.getOutput())
const result = {
  elapsedMs,
  solved: solver.solved,
  failed: solver.failed,
  iterations: solver.iterations,
  outputHash: createHash("sha256").update(output).digest("hex"),
  peakRss: process.resourceUsage().maxRSS,
}
console.log(JSON.stringify(result))
if (process.env.EXPANSION_BENCHMARK_OUTPUT) {
  writeFileSync(
    process.env.EXPANSION_BENCHMARK_OUTPUT,
    JSON.stringify(result, null, 2),
  )
}

if (!solver.solved || solver.failed) process.exitCode = 1
