import { mkdirSync, writeFileSync } from "node:fs"
import { AutoroutingPipelineSolver7_MultiGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../lib/types"
import { loadScenarioBySampleNumber } from "./benchmark/scenarios"
import { TinyHyperGraphSolver, getTinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"

const caseName = process.argv[2]
const outDir = `routing-investigation/${caseName}`
mkdirSync(outDir, { recursive: true })
const serialize = (contents: unknown): string => JSON.stringify(contents, (_key, field) =>
  field instanceof Int8Array || field instanceof Int32Array ||
  field instanceof Uint8Array || field instanceof Uint32Array ||
  field instanceof Float32Array || field instanceof Float64Array
    ? { typedArray: field.constructor.name, entries: [...field] }
    : field,
)
const save = (name: string, contents: unknown): void => {
  writeFileSync(`${outDir}/${name}.json`, serialize(contents))
}
const getPipeline = async (): Promise<AutoroutingPipelineSolver7_MultiGraph | AutoroutingPipelineSolver9_PreloadedTraceGraph> => {
  if (caseName === "srj18-6") {
    const { scenario } = await loadScenarioBySampleNumber("srj18", 6)
    return new AutoroutingPipelineSolver7_MultiGraph(scenario)
  }
  if (caseName === "bugreport77") {
    const report: { simple_route_json: SimpleRouteJson } = await Bun.file("fixtures/bug-reports/bugreport77-07f6a7/bugreport77-07f6a7.json").json()
    return new AutoroutingPipelineSolver7_MultiGraph(report.simple_route_json)
  }
  if (caseName !== "pedometer-low" && caseName !== "pedometer-normal") throw Error(`Unknown case ${caseName}`)
  const srj: SimpleRouteJson = await Bun.file("public/fixtures/bugreport103-pedometer.srj.json").json()
  return new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    effort: caseName === "pedometer-low" ? 0.01 : 1,
    cacheProvider: null,
  })
}

const pipeline = await getPipeline()
const tinySolvers: TinyHyperGraphSolver[] = []
let previousPhase = ""
const start = performance.now()
while (!pipeline.failed && !pipeline.solved && !pipeline.portPointPathingSolver?.solved) {
  pipeline.step()
  const phase = pipeline.getCurrentPhase()
  if (phase !== previousPhase) {
    previousPhase = phase
    console.log(JSON.stringify({ caseName, phase, seconds: (performance.now() - start) / 1000 }))
  }
  for (let active = pipeline.activeSubSolver; active; active = active.activeSubSolver) {
    if (!(active instanceof TinyHyperGraphSolver) || tinySolvers.includes(active)) continue
    const index = tinySolvers.length
    tinySolvers.push(active)
    save(`tiny-${index}-input`, {
      topology: active.topology,
      problem: active.problem,
      options: getTinyHyperGraphSolverOptions(active),
      solverName: active.getSolverName(),
    })
  }
}
for (const [index, solver] of tinySolvers.entries()) {
  save(`tiny-${index}-state`, {
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    stats: solver.stats,
    iterations: solver.iterations,
    regionSegments: solver.state.regionSegments,
    unroutedRoutes: solver.state.unroutedRoutes,
    currentRouteId: solver.state.currentRouteId,
    portAssignment: solver.state.portAssignment,
  })
  console.log(JSON.stringify({ caseName, tinyIndex: index, solved: solver.solved, failed: solver.failed, error: solver.error, stats: solver.stats }))
}
const summary = {
  caseName,
  solved: pipeline.portPointPathingSolver?.solved,
  failed: pipeline.failed,
  error: pipeline.error,
  stats: pipeline.portPointPathingSolver?.stats,
  seconds: (performance.now() - start) / 1000,
  maxRss: process.resourceUsage().maxRSS,
}
save("summary", summary)
console.log(JSON.stringify(summary))
