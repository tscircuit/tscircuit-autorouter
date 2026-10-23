import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  checkDanglingTraces,
  checkTracesAreContiguous,
} from "@tscircuit/checks"
import type { Pipeline7PowerTraceExpansionInput } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"

export type TiEvmRoutingErrors = {
  solver: AutoroutingPipelineSolver9_PreloadedTraceGraph
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
  const finalStage = solver.powerTraceExpansionSolver
  if (!solver.srjWithPointPairs || !finalStage?.solved) {
    throw new Error(solver.error ?? "TI EVM autorouting failed")
  }
  const finalStageInput =
    finalStage.inputSrj as Pipeline7PowerTraceExpansionInput
  const routedTraces = [
    ...finalStageInput.fixedTraces.filter(
      (trace) => trace.__replaces_pcb_trace_id !== undefined,
    ),
    ...finalStage.getOutput(),
  ]

  const circuitJson = convertToCircuitJson(
    solver.srjWithPointPairs,
    routedTraces,
    {
      originalSrj: simpleRouteJson,
      includeOriginalConnections: true,
    },
  )

  return {
    solver,
    danglingTraceMessages: checkDanglingTraces(circuitJson).map(
      ({ message }) => message,
    ),
    nonContiguousTraceMessages: checkTracesAreContiguous(circuitJson).map(
      ({ message }) => message,
    ),
  }
}
