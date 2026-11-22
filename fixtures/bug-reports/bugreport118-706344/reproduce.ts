import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { checkPcbTraceStyle } from "@tscircuit/checks"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import report from "./bugreport118-706344.json" with { type: "json" }

const srj = report.simple_route_json as SimpleRouteJson
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj))
solver.solve()
if (!solver.solved || solver.failed) throw new Error(String(solver.error ?? "Routing did not complete"))

const elements = convertToCircuitJson(
  solver.srjWithPointPairs!,
  solver.getOutputSimplifiedPcbTraces(),
  { originalSrj: srj },
)
const warnings = checkPcbTraceStyle(elements)
if (warnings.length) throw new Error(warnings.map((warning) => warning.message).join("\n"))
