import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { loadMotherboardPowerPhase } from "./repro"

const label: string = process.env.ROUTE_LABEL ?? "current"
const outputDirectory: string = resolve(
  process.env.ROUTE_OUTPUT_DIR ?? "/tmp/motherboard-e2e",
)
mkdirSync(outputDirectory, { recursive: true })
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
  loadMotherboardPowerPhase(),
  { effort: 1, cacheProvider: null },
)
// Optional original implementation for an otherwise identical pipeline.
// Extract it from the reproduction revision as described in performance.md.
if (process.env.BASELINE_PRELOAD_PATH) {
  const baseline = await import(resolve(process.env.BASELINE_PRELOAD_PATH))
  const stage = solver.pipelineDef.find(
    (entry) => entry.solverName === "preloadedTraceGraphSolver",
  )
  if (!stage) throw new Error("Missing preload pipeline stage")
  stage.solverClass = baseline.PreloadedTraceGraphSolver
}
const start: number = performance.now()
let previous: string = ""
let phaseStart: number = start
const phaseWallTimes: Record<string, number> = {}
while (!solver.solved && !solver.failed) {
  const phase: string = solver.getCurrentPhase()
  if (phase !== previous) {
    const now: number = performance.now()
    if (previous) phaseWallTimes[previous] = now - phaseStart
    console.log(
      JSON.stringify({ event: "phase", phase, elapsedMs: now - start }),
    )
    previous = phase
    phaseStart = now
  }
  solver.step()
}
const elapsedMs: number = performance.now() - start
if (previous) phaseWallTimes[previous] = performance.now() - phaseStart
const output = solver.solved ? solver.getOutputSimpleRouteJson() : null
const serializedOutput: string = JSON.stringify(output)
if (output) {
  writeFileSync(
    resolve(outputDirectory, `${label}.output.json`),
    serializedOutput,
  )
}
// Rendering, DRC, serialization and hashing are outside routing time.
const validationInput = solver.solved
  ? {
      inputSrj: loadMotherboardPowerPhase(),
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }
  : null
const drc = validationInput ? evaluateRelaxedDrc(validationInput) : null
if (validationInput) {
  writeFileSync(
    resolve(outputDirectory, `${label}.output.svg`),
    getBugReportSnapshotSvg(validationInput),
  )
}
const summary = {
  label,
  elapsedMs,
  runtime: process.version,
  bunVersion: Bun.version,
  platform: process.platform,
  architecture: process.arch,
  solved: solver.solved,
  failed: solver.failed,
  error: solver.error,
  iterations: solver.iterations,
  phaseWallTimes,
  phaseTimes: solver.timeSpentOnPhase,
  powerExpansionStats: solver.powerTraceExpansionSolver?.stats,
  traceCount: output?.traces?.length,
  relaxedDrcErrorCount: drc?.errors.length,
  outputHash: createHash("sha256").update(serializedOutput).digest("hex"),
}
writeFileSync(
  resolve(outputDirectory, `${label}.summary.json`),
  JSON.stringify(summary, null, 2),
)
console.log(JSON.stringify({ event: "finished", ...summary }))
if (!solver.solved) process.exitCode = 1
