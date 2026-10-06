import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { RELAXED_DRC_OPTIONS } from "./drcPresets"
import { createCopperPourTraceEvaluator } from "./createCopperPourTraceEvaluator"
import { checkSrjCoordinateTerminals } from "./checkSrjCoordinateTerminals"
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

  const result = getDrcErrors(circuitJson, {
    ...RELAXED_DRC_OPTIONS,
    holeClearance: inputSrj.minTraceToHoleEdgeClearance,
    viaPadClearance: inputSrj.minViaEdgeToPadEdgeClearance,
    ...drcOptions,
  })
  const pourErrors = createCopperPourTraceEvaluator(
    inputSrj,
    drcOptions?.traceClearance ?? RELAXED_DRC_OPTIONS.traceClearance ?? 0.1,
    connectivityMaps?.source,
  )(jointTraces)
  const pointTerminals = drcOptions?.includeTraceContinuity === false
    ? { anchoredEndpointErrorIds: new Set<string>(), errors: [] }
    : checkSrjCoordinateTerminals(inputSrj, jointTraces)
  const isUnresolved = (error: GetDrcErrorsResult["errors"][number]): boolean => {
    if (!("pcb_trace_error_id" in error)) return true
    const id = error.pcb_trace_error_id
    // Only the checker's generic endpoint error is replaced by native contact.
    return !pointTerminals.anchoredEndpointErrorIds.has(id)
  }
  return {
    circuitJson,
    errors: [...result.errors.filter(isUnresolved), ...pourErrors, ...pointTerminals.errors],
    errorsWithCenters: [...result.errorsWithCenters.filter(isUnresolved), ...pourErrors, ...pointTerminals.errors],
    locationAwareErrors: [...result.locationAwareErrors.filter(isUnresolved), ...pourErrors, ...pointTerminals.errors],
  }
}
