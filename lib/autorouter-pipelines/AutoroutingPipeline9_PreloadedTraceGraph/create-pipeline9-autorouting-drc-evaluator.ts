import type { AnyCircuitElement } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { annotateTraceEndpointPorts } from "lib/utils/autorouting-drc/annotate-trace-endpoint-ports"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/check-trace-continuity"
import { createTraceObstacleClearanceEvaluator } from "lib/utils/autorouting-drc/check-trace-obstacle-clearance"
import { combinePreloadedAndRoutedTraces } from "lib/utils/combine-preloaded-and-routed-traces"
import { checkViaPairClearance } from "lib/utils/autorouting-drc/check-via-pair-clearance"

type DrcError = Record<string, unknown>

export type Pipeline9AutoroutingDrcResult = {
  circuitJson: AnyCircuitElement[]
  errors: DrcError[]
  errorsWithCenters: DrcError[]
}

/** Reuses static pad geometry while evaluating joint repair candidates. */
export const createPipeline9AutoroutingDrcEvaluator = ({
  originalSrj,
  srjWithPointPairs,
}: {
  originalSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
}): ((routedTraces: SimplifiedPcbTrace[]) => Pipeline9AutoroutingDrcResult) => {
  const conversionOptions = {
    minTraceWidth: originalSrj.minTraceWidth,
    minViaDiameter: originalSrj.minViaDiameter,
    originalSrj,
    includeOriginalConnections: true,
  }
  const evaluateTraceObstacles = createTraceObstacleClearanceEvaluator(
    convertToCircuitJson(srjWithPointPairs, [], conversionOptions),
  )
  return (routedTraces): Pipeline9AutoroutingDrcResult => {
    const traces = combinePreloadedAndRoutedTraces(
      originalSrj.traces ?? [],
      routedTraces,
    )
    const circuitJson = convertToCircuitJson(
      srjWithPointPairs,
      traces,
      conversionOptions,
    )
    const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
    connMap.addConnections(
      circuitJson.flatMap((element) =>
        element.type === "pcb_via" && typeof element.pcb_trace_id === "string"
          ? [[element.pcb_via_id, element.pcb_trace_id]]
          : [],
      ),
    )
    annotateTraceEndpointPorts(circuitJson)
    const obstacleErrors = evaluateTraceObstacles(circuitJson, connMap)
    const errors = [
      ...obstacleErrors.filter((error) => error.type === "pcb_trace_error"),
      ...checkTraceContinuity(circuitJson),
      ...obstacleErrors.filter((error) => error.type !== "pcb_trace_error"),
      ...checkViaPairClearance(circuitJson, connMap),
    ]
    return { circuitJson, errors, errorsWithCenters: errors }
  }
}
