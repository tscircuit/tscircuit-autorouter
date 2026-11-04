import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { loadScenarioBySampleNumber } from "./scenarios"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"

const dataset = process.env.PROBE_DATASET ?? "srj18"
const sample = Number(process.env.PROBE_SAMPLE ?? 15)
const { scenario } = await loadScenarioBySampleNumber(dataset, sample)
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
  structuredClone(scenario),
  { cacheProvider: null, effort: 1 },
)
const stages: Array<Record<string, unknown>> = []
const started = performance.now()
let previousBoundary = started
while (!solver.solved && !solver.failed) {
  const index = solver.currentPipelineStepIndex
  const phase = solver.pipelineDef[index]?.solverName ?? "finished"
  solver.step()
  if (solver.currentPipelineStepIndex !== index || solver.solved || solver.failed) {
    const now = performance.now()
    const memory = process.memoryUsage()
    stages.push({
      phase,
      elapsedMs: now - started,
      stageMs: now - previousBoundary,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      peakRssBytes: process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1024),
    })
    previousBoundary = now
    console.error(JSON.stringify(stages.at(-1)))
  }
}
if (solver.failed) throw new Error(solver.error ?? "Pipeline failed")
const routingMs = performance.now() - started
const routedTraces = solver.getOutputSimplifiedPcbTraces()
const drc = evaluateRelaxedDrc({
  inputSrj: scenario,
  srjWithPointPairs: solver.srjWithPointPairs!,
  routedTraces,
})
const report = {
  dataset, sample, bun: Bun.version,
  contactStats: solver.pipeline9JointDrcRepairSolver?.traceContactRepairSolver?.stats ?? null,
  solved: solver.solved, failed: solver.failed, routingMs,
  peakRssBytes: process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1024),
  drc: drc.errors.length,
  vias: routedTraces.reduce((sum, trace) => sum + trace.route.filter(point => point.route_type === "via").length, 0),
  outputHash: createHash("sha256").update(JSON.stringify(routedTraces)).digest("hex"),
  inputHash: createHash("sha256").update(JSON.stringify(scenario)).digest("hex"),
  phaseTimeSpent: solver.timeSpentOnPhase,
  stages,
}
writeFileSync(process.argv[2]!, JSON.stringify(report, null, 2))
console.log(JSON.stringify({routingMs, peakRssBytes: report.peakRssBytes, drc: report.drc, vias: report.vias}))
