import {
  checkEachPcbTraceNonOverlapping,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import report from "./bugreport133-43ae84.json" with { type: "json" }

const srj = report.simple_route_json as SimpleRouteJson
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
  structuredClone(srj),
)
solver.solve()
if (solver.failed || !solver.solved) throw new Error(String(solver.error))

const elements = convertToCircuitJson(
  solver.srjWithPointPairs!,
  solver.getOutputSimplifiedPcbTraces(),
  { originalSrj: srj },
)
const findings = [
  ...checkEachPcbTraceNonOverlapping(elements),
  ...checkViaTraceClearance(elements),
]
if (findings.length)
  throw new Error(findings.map((issue) => issue.message).join("\n"))
