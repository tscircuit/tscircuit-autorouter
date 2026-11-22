import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import report from "./bugreport111-0535ad.json" with { type: "json" }

const srj = report.simple_route_json as SimpleRouteJson
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj))
solver.solve()
if (!solver.solved || solver.failed) throw new Error(String(solver.error ?? "Routing did not complete"))

console.log("Routed", solver.getOutputSimplifiedPcbTraces().length, "traces")
