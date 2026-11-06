import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { getGeneratedThroughViaCollision } from "lib/utils/getGeneratedThroughViaCollision"
import { materializeGeneratedThroughVias } from "lib/utils/materializeGeneratedThroughVias"

export const materializeAndValidateGeneratedThroughVias = ({
  srj,
  outputTraces,
}: {
  srj: SimpleRouteJson
  outputTraces: SimplifiedPcbTraces
}): SimplifiedPcbTraces => {
  const preservedInputTraces = srj.traces ?? []
  const materializedTraces = materializeGeneratedThroughVias({
    inputTraces: preservedInputTraces,
    outputTraces,
    layerCount: srj.layerCount,
    allowBlindAndBuriedVias: srj.allowBlindAndBuriedVias,
  })
  const supersededTraceIds = new Set(
    materializedTraces.flatMap((trace) => [
      trace.pcb_trace_id,
      ...(trace.__replaces_pcb_trace_id ? [trace.__replaces_pcb_trace_id] : []),
    ]),
  )
  const preservedGeometry = preservedInputTraces.filter(
    (trace) => !supersededTraceIds.has(trace.pcb_trace_id),
  )
  const collisionTraces = [...preservedGeometry, ...materializedTraces]
  const collision = getGeneratedThroughViaCollision({
    srj: { ...srj, traces: collisionTraces },
    preservedInputTraces,
    outputTraces: materializedTraces,
    collisionTraces,
  })
  if (collision) throw new Error(collision)
  return materializedTraces
}
