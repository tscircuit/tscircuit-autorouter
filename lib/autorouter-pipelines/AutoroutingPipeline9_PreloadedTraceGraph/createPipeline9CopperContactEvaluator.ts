import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { CircuitJsonConnectivityMaps } from "lib/utils/convertToCircuitJson"
import { addAutoroutingViaTraceIds } from "./addAutoroutingViaTraceIds"
import { createPipeline9AutoroutingDrcEvaluator } from "./createPipeline9AutoroutingDrcEvaluator"
import {
  getPipeline9DrcErrorCopperPairOrThrow,
  type Pipeline9CopperPair,
} from "./pipeline9JointDrcRepairUtils"

export type Pipeline9CopperContactEvaluator = (input: {
  routedTraces: SimplifiedPcbTrace[]
  /** Trace ids the caller routed, so encoded via ids are not read as traces. */
  evaluatedTraceIds: ReadonlySet<string>
}) => Pipeline9CopperPair[]

/**
 * Lists every pair of copper objects that touch. The Pipeline 9 DRC run with
 * every clearance at zero reports only objects whose copper overlaps, so each
 * error is one contact; its two participants come from the error's structured
 * ids, not its message.
 */
export const createPipeline9CopperContactEvaluator = ({
  inputSrj,
  srjWithPointPairs,
  connectivityMaps,
}: {
  inputSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  connectivityMaps?: CircuitJsonConnectivityMaps
}): Pipeline9CopperContactEvaluator => {
  const evaluateZeroClearanceDrc = createPipeline9AutoroutingDrcEvaluator({
    connectivityMaps,
    inputSrj,
    srjWithPointPairs,
    drcOptions: {
      traceClearance: 0,
      viaClearance: 0,
      viaToPadClearance: 0,
      holeClearance: 0,
    },
  })
  return ({ routedTraces, evaluatedTraceIds }) => {
    const contactDrc = evaluateZeroClearanceDrc(routedTraces, {
      includeTraceContinuity: false,
    })
    return addAutoroutingViaTraceIds({
      errors: contactDrc.errors as unknown as Array<Record<string, unknown>>,
      circuitJson: contactDrc.circuitJson,
      evaluatedTraceIds,
    }).map(getPipeline9DrcErrorCopperPairOrThrow)
  }
}
