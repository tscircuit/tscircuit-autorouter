import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { CircuitJsonConnectivityMaps } from "lib/utils/convertToCircuitJson"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
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
 * Whether a DRC error from the contact run is copper actually touching. Checks
 * that measure clearance report it, and overlap is a clearance of 0 or less.
 * Only the trace overlap check omits it; at zero trace clearance that check
 * reports nothing but overlaps.
 */
const isCopperContactError = (error: Record<string, unknown>): boolean => {
  if (typeof error.actual_clearance === "number") {
    return error.actual_clearance <= 0
  }
  if (error.type === "pcb_trace_error") return true
  throw new Error(
    `Pipeline9 copper contact evaluation cannot tell whether ${String(error.type)} is a contact: it has no actual_clearance`,
  )
}

/**
 * Lists every pair of copper objects that touch, each named by the two copper
 * objects in the error's structured ids rather than by its message.
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
  const evaluateContactDrc = createPipeline9AutoroutingDrcEvaluator({
    connectivityMaps,
    inputSrj,
    srjWithPointPairs,
    drcOptions: {
      traceClearance: 0,
      viaClearance: 0,
      holeClearance: 0,
      // The via-pad check reports an overlapping via as clearance 0, which
      // only fails a positive minimum. Any positive value finds the same
      // contacts: near-misses are dropped by their clearance.
      viaToPadClearance: RELAXED_DRC_OPTIONS.viaClearance,
    },
  })
  return ({ routedTraces, evaluatedTraceIds }) => {
    const contactDrc = evaluateContactDrc(routedTraces, {
      includeTraceContinuity: false,
    })
    return addAutoroutingViaTraceIds({
      errors: (
        contactDrc.errors as unknown as Array<Record<string, unknown>>
      ).filter(isCopperContactError),
      circuitJson: contactDrc.circuitJson,
      evaluatedTraceIds,
    }).map(getPipeline9DrcErrorCopperPairOrThrow)
  }
}
