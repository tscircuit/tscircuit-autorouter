export const getDrcErrorParticipantTraceIds = (
  error: Record<string, unknown>,
): string[] => {
  const primaryTraceId =
    typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined
  const explicitTraceIds = Array.isArray(error.pcb_trace_ids)
    ? error.pcb_trace_ids.filter(
        (traceId): traceId is string => typeof traceId === "string",
      )
    : []
  const viaIds = [
    ...(typeof error.pcb_via_id === "string" ? [error.pcb_via_id] : []),
    ...(Array.isArray(error.pcb_via_ids) ? error.pcb_via_ids : []),
  ].filter((viaId): viaId is string => typeof viaId === "string")
  const pairPrefix = primaryTraceId ? `overlap_${primaryTraceId}_` : undefined
  const encodedOtherTraceId =
    pairPrefix &&
    typeof error.pcb_trace_error_id === "string" &&
    error.pcb_trace_error_id.startsWith(pairPrefix)
      ? error.pcb_trace_error_id.slice(pairPrefix.length)
      : undefined
  if (explicitTraceIds.length > 0) {
    const participantTraceIds =
      primaryTraceId && !explicitTraceIds.includes(primaryTraceId)
        ? [primaryTraceId, ...explicitTraceIds]
        : [...explicitTraceIds]
    if (
      participantTraceIds.length < 2 &&
      encodedOtherTraceId &&
      !viaIds.includes(encodedOtherTraceId)
    ) {
      participantTraceIds.push(encodedOtherTraceId)
    }
    return participantTraceIds
  }
  return [primaryTraceId, encodedOtherTraceId].filter(
    (traceId): traceId is string =>
      typeof traceId === "string" && !viaIds.includes(traceId),
  )
}

export const getDrcErrorTraceIds = (
  error: Record<string, unknown>,
): string[] => {
  return getDrcErrorParticipantTraceIds(error).filter(
    (traceId, traceIndex, allTraceIds) =>
      allTraceIds.indexOf(traceId) === traceIndex,
  )
}
