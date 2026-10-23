import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  checkDanglingTraces,
  checkTracesAreContiguous,
} from "@tscircuit/checks"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

export type TiEvmRoutingErrors = {
  danglingTraceMessages: string[]
  nonContiguousTraceMessages: string[]
}

export function getPipeline9TiEvmRoutingErrors({
  fixtureUrl,
}: {
  fixtureUrl: URL
}): TiEvmRoutingErrors {
  const simpleRouteJson = JSON.parse(
    gunzipSync(Uint8Array.from(readFileSync(fixtureUrl))).toString("utf8"),
  ) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(simpleRouteJson),
    { effort: 1 },
  )

  solver.solve()
  if (solver.failed || !solver.srjWithPointPairs) {
    throw new Error(solver.error ?? "TI EVM autorouting failed")
  }

  const circuitJson = convertToCircuitJson(
    solver.srjWithPointPairs,
    solver.getOutputSimplifiedPcbTraces(),
    {
      originalSrj: simpleRouteJson,
      includeOriginalConnections: true,
    },
  )

  return {
    danglingTraceMessages: checkDanglingTraces(circuitJson).map(
      ({ message }) => message,
    ),
    nonContiguousTraceMessages: checkTracesAreContiguous(circuitJson).map(
      ({ message }) => message,
    ),
  }
}
