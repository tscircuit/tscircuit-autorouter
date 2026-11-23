import { checkEachPcbTraceNonOverlapping } from "@tscircuit/checks"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import report from "./bugreport112-a609d5.json" with { type: "json" }

const input = report.simple_route_json as SimpleRouteJson
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
  structuredClone(input),
)
solver.solve()
if (!solver.solved || solver.failed) throw Error(String(solver.error))

const board = convertToCircuitJson(
  solver.srjWithPointPairs!,
  solver.getOutputSimplifiedPcbTraces(),
  { originalSrj: input },
)
const errors = checkEachPcbTraceNonOverlapping(board, {
  minClearance: input.minTraceToPadEdgeClearance,
})
if (errors.length) throw Error(errors.map((error) => error.message).join("\n"))
