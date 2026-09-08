import type { AnyCircuitElement } from "circuit-json"

export const addAutoroutingViaTraceIds = ({
  errors,
  circuitJson,
  evaluatedTraceIds,
}: {
  errors: Array<Record<string, unknown>>
  circuitJson: AnyCircuitElement[]
  evaluatedTraceIds: ReadonlySet<string>
}): Array<Record<string, unknown>> => {
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
    const explicitViaIds = [
      ...(typeof error.pcb_via_id === "string" ? [error.pcb_via_id] : []),
      ...(Array.isArray(error.pcb_via_ids)
        ? error.pcb_via_ids.filter(
            (viaId): viaId is string => typeof viaId === "string",
          )
        : []),
    ]
    const primaryTraceId =
      typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined
    const pairPrefix = primaryTraceId ? `overlap_${primaryTraceId}_` : undefined
    const encodedPairTraceId =
      pairPrefix &&
      typeof error.pcb_trace_error_id === "string" &&
      error.pcb_trace_error_id.startsWith(pairPrefix)
        ? error.pcb_trace_error_id.slice(pairPrefix.length)
        : undefined
    const encodedViaIdCandidate =
      typeof error.pcb_trace_error_id === "string"
        ? error.pcb_trace_error_id.match(/_(via_\d+)$/)?.[1]
        : undefined
    const encodedViaId =
      explicitViaIds.length === 0 &&
      encodedViaIdCandidate &&
      traceIdByViaId.has(encodedViaIdCandidate) &&
      !(encodedPairTraceId && evaluatedTraceIds.has(encodedPairTraceId))
        ? encodedViaIdCandidate
        : undefined
    const viaIds = [
      ...explicitViaIds,
      ...(encodedViaId ? [encodedViaId] : []),
    ].filter(
      (viaId, viaIndex, allViaIds) => allViaIds.indexOf(viaId) === viaIndex,
    )
    const traceIds = [
      ...(typeof error.pcb_trace_id === "string" ? [error.pcb_trace_id] : []),
      ...(Array.isArray(error.pcb_trace_ids)
        ? error.pcb_trace_ids.filter(
            (traceId): traceId is string => typeof traceId === "string",
          )
        : []),
      ...viaIds.flatMap((viaId) => {
        const traceId = traceIdByViaId.get(viaId)
        return traceId ? [traceId] : []
      }),
    ].filter(
      (traceId, traceIndex, allTraceIds) =>
        allTraceIds.indexOf(traceId) === traceIndex,
    )
    return {
      ...error,
      ...(viaIds.length > 0
        ? { pcb_via_id: viaIds[0], pcb_via_ids: viaIds }
        : {}),
      ...(viaIds.length > 0 && traceIds.length > 0
        ? { pcb_trace_ids: traceIds }
        : {}),
    }
  })
}
