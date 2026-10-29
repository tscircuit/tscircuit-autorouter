import type { AnyCircuitElement } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import {
  type CircuitJsonConnectivityMaps,
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { annotateTraceEndpointPorts } from "lib/utils/autorouting-drc/annotateTraceEndpointPorts"
import { checkBoardTraceClearance } from "lib/utils/autorouting-drc/checkBoardTraceClearance"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"
import { checkViaPairClearance } from "lib/utils/autorouting-drc/checkViaPairClearance"
import { createTraceObstacleClearanceEvaluator } from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"
import { createViaPadClearanceEvaluator } from "lib/utils/autorouting-drc/createViaPadClearanceEvaluator"
import { combinePreloadedAndRoutedTraces } from "lib/utils/combinePreloadedAndRoutedTraces"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"

type DrcError = Record<string, unknown>

export type AutoroutingDrcOptions = {
  holeClearance?: number
  viaClearance?: number
  viaToPadClearance?: number
  traceClearance?: number
  includeTraceContinuity?: boolean
  includeTypedTraceClearance?: boolean
}

export type Pipeline9AutoroutingDrcResult = {
  circuitJson: AnyCircuitElement[]
  errors: DrcError[]
  errorsWithCenters: DrcError[]
  locationAwareErrors: DrcError[]
}

/** Reuses static pad geometry while evaluating joint repair candidates. */
export const createPipeline9AutoroutingDrcEvaluator = ({
  originalSrj,
  srjWithPointPairs,
  drcOptions = {},
  includeBoardClearance = false,
  connectivityMaps,
}: {
  originalSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  drcOptions?: AutoroutingDrcOptions
  includeBoardClearance?: boolean
  connectivityMaps?: CircuitJsonConnectivityMaps
}): ((
  routedTraces: SimplifiedPcbTrace[],
  options?: { includeTraceContinuity?: boolean },
) => Pipeline9AutoroutingDrcResult) => {
  const conversionOptions = {
    minTraceWidth: originalSrj.minTraceWidth,
    minViaDiameter: originalSrj.minViaDiameter,
    originalSrj,
    includeOriginalConnections: true,
    connectivityMaps,
  }
  const board = includeBoardClearance
    ? createPcbBoardElement({
        ...originalSrj,
        minBoardEdgeClearance: originalSrj.minBoardEdgeClearance ?? 0,
      })
    : undefined
  const staticCircuitJson = convertToCircuitJson(
    srjWithPointPairs,
    [],
    conversionOptions,
  )
  if (board) staticCircuitJson.push(board)
  const evaluateTraceObstacles = createTraceObstacleClearanceEvaluator(
    staticCircuitJson,
    {
      traceClearance: drcOptions.traceClearance ?? 0.1,
      holeClearance:
        drcOptions.holeClearance ?? originalSrj.minTraceToHoleEdgeClearance,
    },
  )
  const evaluateViaPads = createViaPadClearanceEvaluator(staticCircuitJson, {
    minClearance:
      drcOptions.viaToPadClearance ?? getViaToPadClearance(originalSrj),
  })
  return (routedTraces, options = {}): Pipeline9AutoroutingDrcResult => {
    const traces = combinePreloadedAndRoutedTraces(
      originalSrj.traces ?? [],
      routedTraces,
    )
    const circuitJson = convertToCircuitJson(
      srjWithPointPairs,
      traces,
      conversionOptions,
    )
    if (board) circuitJson.push(board)
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
      ...obstacleErrors.traceErrors,
      ...checkBoardTraceClearance(circuitJson, { board }),
      ...((options.includeTraceContinuity ??
        drcOptions.includeTraceContinuity) === false
        ? []
        : checkTraceContinuity(circuitJson)),
      ...(drcOptions.includeTypedTraceClearance === false
        ? []
        : [...obstacleErrors.viaErrors, ...obstacleErrors.padErrors]),
      ...obstacleErrors.holeErrors,
      ...evaluateViaPads(circuitJson, connMap),
      ...checkViaPairClearance(circuitJson, connMap, {
        viaClearance: drcOptions.viaClearance ?? 0.1,
      }),
    ]
    const viasById = new Map(
      circuitJson.flatMap((element) =>
        element.type === "pcb_via"
          ? [[element.pcb_via_id, element] as const]
          : [],
      ),
    )
    const errorsWithCenters = errors.map((error): DrcError => {
      if (error.type === "pcb_via_trace_clearance_error") {
        const via = viasById.get(error.pcb_via_id as string)
        if (via) return { ...error, center: { x: via.x, y: via.y } }
      }
      if (error.center) return error
      if (error.pcb_center) return { ...error, center: error.pcb_center }
      return error
    })
    return {
      circuitJson,
      errors,
      errorsWithCenters,
      locationAwareErrors: errorsWithCenters.filter((error) =>
        Boolean(error.center),
      ),
    }
  }
}
