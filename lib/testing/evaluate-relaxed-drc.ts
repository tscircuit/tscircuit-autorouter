import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { RELAXED_DRC_OPTIONS } from "./drcPresets"
import {
  getDrcErrors,
  type GetDrcErrorsOptions,
  type GetDrcErrorsResult,
} from "./getDrcErrors"
import {
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

  return {
    circuitJson,
    ...getDrcErrors(circuitJson, {
      ...RELAXED_DRC_OPTIONS,
      ...drcOptions,
    }),
  }
}
