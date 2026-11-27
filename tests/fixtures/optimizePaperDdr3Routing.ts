import {
  optimizeRouteVias,
  type Trace as BusLanesTrace,
} from "@tscircuit/bus-lanes-solver"
import { checkEachPcbPortConnectedToPcbTraces } from "@tscircuit/checks"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcInput,
} from "lib/testing/evaluate-relaxed-drc"
import type { SimplifiedPcbTrace } from "lib/types"
import { checkBoardTraceClearance } from "lib/utils/autorouting-drc/checkBoardTraceClearance"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"

interface PaperDdr3ViaOptimization {
  routing: EvaluateRelaxedDrcInput
  originalViaCount: number
  optimizedViaCount: number
}

export function optimizePaperDdr3Routing(
  input: EvaluateRelaxedDrcInput,
): PaperDdr3ViaOptimization {
  const reference = input.inputSrj
  const traces = combinePreloadedAndRoutedTraces(
    reference.traces ?? [],
    input.routedTraces,
  ).map((trace) => ({
    ...trace,
    route: trace.route.map((point) => {
      if (point.route_type === "wire" || point.route_type === "via") return point
      throw new Error(`Unsupported copper in ${trace.pcb_trace_id}`)
    }),
  }))
  const connections = reference.connections.map((connection) => ({
    ...connection,
    pointsToConnect: connection.pointsToConnect.map((point) => {
      if (point.layer !== undefined) return { ...point, layer: point.layer }
      throw new Error(
        `Expected fixed DDR terminal layers for ${connection.name}`,
      )
    }),
  }))

  function snapshotInput(
    candidate: readonly (SimplifiedPcbTrace & BusLanesTrace)[],
  ): EvaluateRelaxedDrcInput {
    const srj = { ...reference, traces: [...candidate] }
    return {
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: [],
      includeBoardClearance: true,
    }
  }

  const original = evaluateRelaxedDrc(snapshotInput(traces))
  const optimized = optimizeRouteVias(
    { ...reference, connections, traces },
    {
      searchPadding: 2.5,
      maxCandidates: 256,
      validate: (candidate) => {
        const { circuitJson, errors } = evaluateRelaxedDrc(
          snapshotInput(candidate),
        )
        return (
          errors.length === 0 &&
          checkBoardTraceClearance(circuitJson).length === 0 &&
          checkTraceContinuity(circuitJson).length === 0 &&
          checkEachPcbPortConnectedToPcbTraces(circuitJson).length === 0
        )
      },
    },
  )
  const routing = snapshotInput(optimized)
  const result = evaluateRelaxedDrc(routing)
  return {
    routing,
    originalViaCount: original.circuitJson.filter(
      (element) => element.type === "pcb_via",
    ).length,
    optimizedViaCount: result.circuitJson.filter(
      (element) => element.type === "pcb_via",
    ).length,
  }
}
