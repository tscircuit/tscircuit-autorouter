import { readFileSync, writeFileSync } from "node:fs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

const input: SimpleRouteJson = JSON.parse(readFileSync(process.argv[2]!, "utf8"))
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null })
let failure: string | undefined
try {
  solver.solve()
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
}
const target = "source_net_25_mst159"
const stages: { stage: string; routes: HighDensityRoute[] }[] = [
  { stage: "high_density", routes: solver.highDensityRouteSolver?.routes ?? [] },
  { stage: "stitch", routes: solver.highDensityStitchSolver?.mergedHdRoutes ?? [] },
  { stage: "simplification", routes: solver.traceSimplificationSolver?.simplifiedHdRoutes ?? [] },
  { stage: "trace_width", routes: solver.traceWidthSolver?.getHdRoutesWithWidths() ?? [] },
]
const result = {
  solved: solver.solved,
  failed: solver.failed,
  stage: solver.getCurrentPhase(),
  failure: failure ?? solver.error,
  stages: stages.map(({ stage, routes }) => ({ stage, routes: routes.filter((route) => route.connectionName === target) })),
  connections: solver.netToPointPairsSolver?.newConnections.filter((connection) => connection.name === target),
}
writeFileSync("orangecrab-taper-capture.json", JSON.stringify(result, null, 2))
console.log("ORANGECRAB_TAPER_CAPTURE " + JSON.stringify(result))
