import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import report from "./bugreport132-2cbaf6.json" with { type: "json" }

const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
  structuredClone(report.simple_route_json as SimpleRouteJson),
)
solver.solve()
if (solver.failed || !solver.solved) throw new Error(String(solver.error))
