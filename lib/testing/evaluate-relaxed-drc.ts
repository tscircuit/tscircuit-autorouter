import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { RELAXED_DRC_OPTIONS } from "./drcPresets"
import { getDrcErrors, type GetDrcErrorsResult } from "./getDrcErrors"
import { convertToCircuitJson } from "./utils/convertToCircuitJson"

/** Inputs used by the benchmark's relaxed DRC evaluation. */
export interface EvaluateRelaxedDrcInput {
  inputSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  /** Newly routed traces. Input traces are always included automatically. */
  routedTraces: SimplifiedPcbTrace[]
}

/** Benchmark relaxed DRC errors and the Circuit JSON evaluated to produce them. */
export interface EvaluateRelaxedDrcResult extends GetDrcErrorsResult {
  circuitJson: AnyCircuitElement[]
}

/** Converts routed traces and evaluates them using the benchmark relaxed DRC. */
export const evaluateRelaxedDrc = ({
  inputSrj,
  srjWithPointPairs,
  routedTraces,
}: EvaluateRelaxedDrcInput): EvaluateRelaxedDrcResult => {
  const preloadedTraces = inputSrj.traces ?? []
  const jointTraces = [...preloadedTraces, ...routedTraces]
  const circuitJson = convertToCircuitJson(srjWithPointPairs, jointTraces, {
    minTraceWidth: inputSrj.minTraceWidth,
    minViaDiameter: inputSrj.minViaDiameter,
    originalSrj: inputSrj,
    includeOriginalConnections: true,
  })

  return {
    circuitJson,
    ...getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS),
  }
}
