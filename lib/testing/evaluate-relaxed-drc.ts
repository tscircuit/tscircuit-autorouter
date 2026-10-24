import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import {
  getSimplifiedTracesViaPlacementViolations,
  hasCustomViaKeepoutOrClearanceRules,
} from "lib/utils/viaKeepoutUtils"
import { RELAXED_DRC_OPTIONS } from "./drcPresets"
import {
  getDrcErrors,
  type GetDrcErrorsOptions,
  type GetDrcErrorsResult,
} from "./getDrcErrors"
import {
  type CircuitJsonConnectivityMaps,
  convertToCircuitJson,
  createPcbBoardElement,
} from "./utils/convertToCircuitJson"

/** Inputs used by the benchmark's relaxed DRC evaluation. */
export interface EvaluateRelaxedDrcInput {
  inputSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  /** Newly routed traces. Input traces are always included automatically. */
  routedTraces: SimplifiedPcbTrace[]
  /** Override benchmark defaults when validating a board's declared rules. */
  drcOptions?: GetDrcErrorsOptions
  /** Preserve physical board clearance when validating repair candidates. */
  includeBoardClearance?: boolean
  connectivityMaps?: CircuitJsonConnectivityMaps
}

/** Benchmark relaxed DRC errors and the Circuit JSON evaluated to produce them. */
export interface EvaluateRelaxedDrcResult extends GetDrcErrorsResult {
  circuitJson: AnyCircuitElement[]
}

/**
 * Combines existing and newly routed copper. Only traces with explicit
 * replacement metadata remove preloaded copper; ids may otherwise collide.
 */
export const combinePreloadedAndRoutedTraces = (
  preloadedTraces: SimplifiedPcbTrace[],
  routedTraces: SimplifiedPcbTrace[],
): SimplifiedPcbTrace[] => {
  const replacedTraceIds = new Set(
    routedTraces.flatMap((trace) =>
      trace.__replaces_pcb_trace_id ? [trace.__replaces_pcb_trace_id] : [],
    ),
  )
  return [
    ...preloadedTraces.filter(
      (trace) => !replacedTraceIds.has(trace.pcb_trace_id),
    ),
    ...routedTraces,
  ]
}

/** Converts routed traces and evaluates them using the benchmark relaxed DRC. */
export const evaluateRelaxedDrc = ({
  inputSrj,
  srjWithPointPairs,
  routedTraces,
  drcOptions,
  includeBoardClearance = false,
  connectivityMaps,
}: EvaluateRelaxedDrcInput): EvaluateRelaxedDrcResult => {
  const preloadedTraces = inputSrj.traces ?? []
  const jointTraces = combinePreloadedAndRoutedTraces(
    preloadedTraces,
    routedTraces,
  )
  const circuitJson = convertToCircuitJson(srjWithPointPairs, jointTraces, {
    minTraceWidth: inputSrj.minTraceWidth,
    minViaDiameter: inputSrj.minViaDiameter,
    originalSrj: inputSrj,
    includeOriginalConnections: true,
    connectivityMaps,
  })

  if (includeBoardClearance) {
    circuitJson.push(
      createPcbBoardElement({
        ...inputSrj,
        // Match the repair solver's board constraint instead of introducing
        // the manufacturing checker's default margin for an unspecified rule.
        minBoardEdgeClearance: inputSrj.minBoardEdgeClearance ?? 0,
      }),
    )
  }

  const drcResult = getDrcErrors(circuitJson, {
    ...RELAXED_DRC_OPTIONS,
    holeClearance: inputSrj.minTraceToHoleEdgeClearance,
    ...drcOptions,
  })

  if (hasCustomViaKeepoutOrClearanceRules(inputSrj, inputSrj.obstacles)) {
    const connMap =
      connectivityMaps?.route ??
      getConnectivityMapFromSimpleRouteJson(srjWithPointPairs)
    const defaultViaDiameter = getViaDimensions(inputSrj).padDiameter
    const viaViolations = getSimplifiedTracesViaPlacementViolations({
      traces: jointTraces,
      srj: inputSrj,
      connMap,
      defaultViaDiameter,
    })
    for (const violation of viaViolations) {
      const errorObj = {
        type: "pcb_pad_pad_clearance_error" as const,
        pcb_pad_pad_clearance_error_id: `via_placement_${violation.pcbTraceId ?? violation.connectionName}_${violation.viaCenter.x.toFixed(4)}_${violation.viaCenter.y.toFixed(4)}_${violation.obstacleId ?? violation.keepoutId ?? "keepout"}`,
        error_type: "pcb_pad_pad_clearance_error" as const,
        message: violation.message,
        pcb_trace_id: violation.pcbTraceId,
        pcb_trace_ids: violation.pcbTraceId ? [violation.pcbTraceId] : [],
        pcb_pad_ids: [
          ...(violation.obstacleId ? [violation.obstacleId] : []),
          ...(violation.keepoutId ? [violation.keepoutId] : []),
        ],
        minimum_clearance: violation.minimumClearance,
        actual_clearance: violation.actualClearance,
        center: violation.location,
        reason: violation.reason,
      } as any
      drcResult.errors.push(errorObj)
      drcResult.errorsWithCenters.push(errorObj)
      drcResult.locationAwareErrors.push(errorObj)
    }
  }

  return {
    circuitJson,
    ...drcResult,
  }
}
