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
    const primaryTraceId =
      typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined
    const explicitTraceIds = Array.isArray(error.pcb_trace_ids)
      ? error.pcb_trace_ids.filter(
          (traceId): traceId is string => typeof traceId === "string",
        )
      : []
    const viaIds = [
      ...(typeof error.pcb_via_id === "string" ? [error.pcb_via_id] : []),
      ...(Array.isArray(error.pcb_via_ids)
        ? error.pcb_via_ids.filter(
            (viaId): viaId is string => typeof viaId === "string",
          )
        : []),
    ].filter(
      (viaId, viaIndex, allViaIds) => allViaIds.indexOf(viaId) === viaIndex,
    )
    if (primaryTraceId && typeof error.pcb_trace_error_id === "string") {
      const pairPrefix = `overlap_${primaryTraceId}_`
      const encodedOtherTraceId = error.pcb_trace_error_id.startsWith(
        pairPrefix,
      )
        ? error.pcb_trace_error_id.slice(pairPrefix.length)
        : undefined
      const encodedIdentityIsVia =
        encodedOtherTraceId !== undefined &&
        (viaIds.includes(encodedOtherTraceId) ||
          (traceIdByViaId.has(encodedOtherTraceId) &&
            !explicitTraceIds.includes(encodedOtherTraceId)))
      const otherTraceId =
        explicitTraceIds.find(
          (traceId) => traceId !== primaryTraceId && newTraceIds.has(traceId),
        ) ??
        (encodedOtherTraceId && !encodedIdentityIsVia
          ? encodedOtherTraceId
          : undefined)
      if (
        !newTraceIds.has(primaryTraceId) &&
        viaIds.length === 0 &&
        otherTraceId &&
        newTraceIds.has(otherTraceId)
      ) {
        const traceIds = [
          otherTraceId,
          primaryTraceId,
          ...explicitTraceIds,
        ].filter(
          (traceId, traceIndex, allTraceIds) =>
            allTraceIds.indexOf(traceId) === traceIndex,
        )
        return {
          ...error,
          pcb_trace_id: otherTraceId,
          pcb_trace_ids: traceIds,
          pcb_trace_error_id: `overlap_${otherTraceId}_${primaryTraceId}`,
        }
      }
    }

    const mappedViaTraceIds = viaIds
      .flatMap((viaId) => {
        const traceId = traceIdByViaId.get(viaId)
        return traceId ? [traceId] : []
      })
      .filter(
        (traceId, traceIndex, allTraceIds) =>
          allTraceIds.indexOf(traceId) === traceIndex,
      )
    const viaTraceIds =
      mappedViaTraceIds.length > 0
        ? mappedViaTraceIds
        : explicitTraceIds.filter((traceId) => traceId !== primaryTraceId)
    const primaryMovableViaTraceId = viaTraceIds.find((traceId) =>
      newTraceIds.has(traceId),
    )
    if (
      primaryMovableViaTraceId &&
      (!primaryTraceId || !newTraceIds.has(primaryTraceId))
    ) {
      const traceIds = [
        primaryMovableViaTraceId,
        ...(primaryTraceId ? [primaryTraceId] : []),
        ...explicitTraceIds,
        ...viaTraceIds,
      ].filter(
        (traceId, traceIndex, allTraceIds) =>
          allTraceIds.indexOf(traceId) === traceIndex,
      )
      return {
        ...error,
        pcb_trace_id: primaryMovableViaTraceId,
        pcb_trace_ids: traceIds,
        pcb_via_id: viaIds[0],
        pcb_via_ids: viaIds,
      }
    }

    if (viaIds.length > 0) {
      const traceIds = [
        ...(primaryTraceId ? [primaryTraceId] : []),
        ...explicitTraceIds,
        ...viaTraceIds,
      ].filter(
        (traceId, traceIndex, allTraceIds) =>
          allTraceIds.indexOf(traceId) === traceIndex,
      )
      return {
        ...error,
        pcb_trace_ids: traceIds,
        pcb_via_id: viaIds[0],
        pcb_via_ids: viaIds,
      }
    }

    return error
  })
}
