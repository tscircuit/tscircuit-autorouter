import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"

const { PowerTraceExpanderSolver } = await import(
  process.env.EXPANDER_MODULE ?? "@tscircuit/power-trace-expander"
)
const [input, options] = JSON.parse(readFileSync(process.argv[2]!, "utf8"))
const solver = new PowerTraceExpanderSolver(input, options)
const started = performance.now()
solver.solve()
const elapsedMs = performance.now() - started
const traces = solver.getOutput()
const drc = evaluateRelaxedDrc({
  inputSrj: input,
  srjWithPointPairs: input,
  routedTraces: traces,
})
const errorCounts: Record<string, number> = {}
for (const error of drc.errors) {
  errorCounts[error.type] = (errorCounts[error.type] ?? 0) + 1
}
const report = {
  elapsedMs,
  solved: solver.solved,
  failed: solver.failed,
  iterations: solver.iterations,
  outputHash: createHash("sha256").update(JSON.stringify(traces)).digest("hex"),
  widthDeficit: solver.calculateWidthDeficit(),
  errorCounts,
  stats: solver.stats,
}
writeFileSync(process.argv[3]!, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, stats: undefined }))
if (!solver.solved || solver.failed) process.exitCode = 1
