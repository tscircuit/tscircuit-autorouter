import { mkdirSync, writeFileSync } from "node:fs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber, parseDatasetName } from "../../scripts/benchmark/scenarios"

const dataset = parseDatasetName(process.argv[2] ?? "srj18")
if (!dataset) throw new Error("Unknown dataset")
const sample = Number(process.argv[3] ?? 1)
const mode = process.argv[4] ?? "enabled"
const outputDir = process.argv[5] ?? "/tmp/ordered-portals"
const input = await loadScenarioBySampleNumber(dataset, sample, 1)
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input.scenario, {
  effort: 1,
  flexibleBoundaries: mode !== "disabled",
  orderedPortals: mode !== "coarsen-only",
  coarsenBoundaries: mode !== "sliding-only" && mode !== "v1-sliding-only",
  requireStraightCellWitness: mode !== "v1" && mode !== "v1-sliding-only",
})
mkdirSync(outputDir, { recursive: true })
let exception: string | undefined
let wroteReplay = false
let phase = solver.getCurrentPhase()
const start = performance.now()
try {
  while (!solver.solved && !solver.failed) {
    solver.step()
    if (solver.getCurrentPhase() !== phase) {
      console.error(JSON.stringify({ completedPhase: phase, elapsedMs: performance.now() - start }))
      phase = solver.getCurrentPhase()
    }
    if (!wroteReplay && solver.orderedPortalStats) {
      writeFileSync(`${outputDir}/${dataset}-${sample}-${mode}-input.json`, JSON.stringify({
        nodes: solver.uniformPortDistributionSolver!.getOutput(),
        physicalTerminals: input.scenario.connections.flatMap((connection) => connection.pointsToConnect),
        obstacles: solver.srj.obstacles,
        highDensityNodes: solver.highDensityNodePortPoints,
        stats: solver.orderedPortalStats,
      }))
      wroteReplay = true
    }
  }
} catch (error) {
  exception = String(error)
}
let drc: ReturnType<typeof evaluateRelaxedDrc> | undefined
if (solver.solved) drc = evaluateRelaxedDrc({ inputSrj: input.scenario, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: solver.getOutputSimplifiedPcbTraces() })
const result = {
  dataset, sample, scenario: input.scenarioName, mode,
  timingCaveat: "Local diagnostic only; controlled performance comparisons run on Blacksmith",
  durationMs: performance.now() - start,
  solved: solver.solved, failed: solver.failed, error: solver.error, exception,
  phase: solver.getCurrentPhase(), phases: solver.timeSpentOnPhase,
  iterations: solver.iterations,
  highDensityIterations: solver.highDensityRouteSolver?.iterations,
  orderedPortalStats: solver.orderedPortalStats,
  flexibleBoundaryStats: solver.flexibleBoundaryStats,
  drcErrors: drc?.errors,
}
writeFileSync(`${outputDir}/${dataset}-${sample}-${mode}.json`, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
