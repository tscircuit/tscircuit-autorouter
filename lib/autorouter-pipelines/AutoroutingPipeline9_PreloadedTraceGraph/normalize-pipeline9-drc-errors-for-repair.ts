import type { AnyCircuitElement } from "circuit-json"

type DrcError = Record<string, unknown>

/** Makes the movable new route the primary identity in joint DRC errors. */
export const normalizePipeline9DrcErrorsForRepair = ({
  errors,
  circuitJson,
  newTraceIds,
}: {
  errors: DrcError[]
  circuitJson: AnyCircuitElement[]
  newTraceIds: ReadonlySet<string>
}): DrcError[] => {
  const traceIdByViaId = new Map(
    circuitJson.flatMap((element) =>
      element.type === "pcb_via" &&
      typeof element.pcb_via_id === "string" &&
      typeof element.pcb_trace_id === "string"
        ? [[element.pcb_via_id, element.pcb_trace_id] as const]
        : [],
    ),
  )

  return errors.map((error) => {
    const primaryTraceId = error.pcb_trace_id
    if (typeof primaryTraceId !== "string") return error

    const errorId = error.pcb_trace_error_id
    const pairPrefix = `overlap_${primaryTraceId}_`
    const otherTraceId =
      typeof errorId === "string" && errorId.startsWith(pairPrefix)
        ? errorId.slice(pairPrefix.length)
        : undefined
    if (
      !newTraceIds.has(primaryTraceId) &&
      otherTraceId &&
      newTraceIds.has(otherTraceId)
    ) {
      return {
        ...error,
        pcb_trace_id: otherTraceId,
        pcb_trace_ids: [otherTraceId, primaryTraceId],
        pcb_trace_error_id: `overlap_${otherTraceId}_${primaryTraceId}`,
      }
    }

    const viaId = error.pcb_via_id
    const viaTraceId =
      typeof viaId === "string" ? traceIdByViaId.get(viaId) : undefined
    if (viaTraceId && newTraceIds.has(viaTraceId)) {
      return {
        ...error,
        pcb_trace_id: viaTraceId,
        pcb_via_ids: [viaId],
      }
    }

    return error
  })
}
