import { mkdirSync, writeFileSync } from "node:fs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { loadScenarioBySampleNumber } from "./scenarios"

const output = process.argv[2]!
mkdirSync(output, { recursive: true })
const { scenario } = await loadScenarioBySampleNumber("srj18", 12)
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
  structuredClone(scenario),
  { cacheProvider: null, effort: 1 },
)
solver.solve()
if (!solver.solved || solver.failed) throw new Error(solver.error ?? "Unsolved")
const stages = {
  stitch: solver.highDensityStitchSolver!.mergedHdRoutes,
  simplification: solver.traceSimplificationSolver!.simplifiedHdRoutes,
  width: solver.traceWidthSolver!.getHdRoutesWithWidths(),
}
const traces = solver.getOutputSimplifiedPcbTraces()
writeFileSync(`${output}/stages.json`, JSON.stringify({
  stages,
  traces,
  phaseTimes: solver.timeSpentOnPhase,
}))
writeFileSync(`${output}/pcb.svg`, getBugReportSnapshotSvg({
  inputSrj: scenario,
  srjWithPointPairs: solver.srjWithPointPairs!,
  routedTraces: traces,
}))
console.log("SAMPLE12_STAGES", JSON.stringify(Object.fromEntries(
  Object.entries(stages).map(([name, routes]) => [name, {
    routes: routes.length,
    vias: routes.reduce((sum, route) => sum + route.vias.length, 0),
  }]),
)))
