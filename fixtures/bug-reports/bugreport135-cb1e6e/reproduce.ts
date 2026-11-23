import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import report from "./bugreport135-cb1e6e.json" with { type: "json" }

const srj = report.simple_route_json as SimpleRouteJson
// Same solver and options that @tscircuit/core uses for this board.
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
  structuredClone(srj),
  { cacheProvider: null },
)
solver.solve()
if (!solver.solved || solver.failed)
  throw new Error(
    `${solver.getCurrentPhase()} failed after ${solver.iterations} iterations: ${solver.error ?? "Routing did not complete"}`,
  )
