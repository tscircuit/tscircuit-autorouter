import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  checkDanglingTraces,
  checkTracesAreContiguous,
} from "@tscircuit/checks"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

export const getTiEvmTerminalRoutingErrors = ({
  fixtureUrl,
  pipeline,
}: {
  fixtureUrl: URL
  pipeline: 7 | 9
}) => {
  const input = JSON.parse(
    gunzipSync(Uint8Array.from(readFileSync(fixtureUrl))).toString("utf8"),
  ) as SimpleRouteJson
  const solver =
    pipeline === 7
      ? new AutoroutingPipelineSolver7_MultiGraph(structuredClone(input), {
          effort: 1,
        })
      : new AutoroutingPipelineSolver9_PreloadedTraceGraph(
          structuredClone(input),
          { effort: 1 },
        )

  solver.solve()
  if (solver.failed || !solver.srjWithPointPairs) {
    throw new Error(solver.error ?? "TI EVM autorouting failed")
  }

  const circuitJson = convertToCircuitJson(
    solver.srjWithPointPairs,
    solver.getOutputSimplifiedPcbTraces(),
    { originalSrj: input, includeOriginalConnections: true },
  )

  return [
    ...checkTracesAreContiguous(circuitJson),
    ...checkDanglingTraces(circuitJson),
  ]
}
