import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { combinePreloadedAndRoutedTraces } from "lib/utils/combinePreloadedAndRoutedTraces"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
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

export { combinePreloadedAndRoutedTraces } from "lib/utils/combinePreloadedAndRoutedTraces"

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

  return {
    circuitJson,
    ...getDrcErrors(circuitJson, {
      ...RELAXED_DRC_OPTIONS,
      holeClearance: inputSrj.minTraceToHoleEdgeClearance,
      viaToPadClearance: getViaToPadClearance(inputSrj),
      ...drcOptions,
    }),
  }
}
