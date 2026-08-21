import type { AnyCircuitElement } from "circuit-json";

type DrcError = Record<string, unknown>;

/** Makes the movable new route the primary identity in joint DRC errors. */
export const normalizePipeline9DrcErrorsForRepair = ({
  errors,
  circuitJson,
  newTraceIds,
}: {
  errors: DrcError[];
  circuitJson: AnyCircuitElement[];
  newTraceIds: ReadonlySet<string>;
}): DrcError[] => {
  const traceIdByViaId = new Map(
    circuitJson.flatMap((element) =>
      element.type === "pcb_via" &&
      typeof element.pcb_via_id === "string" &&
      typeof element.pcb_trace_id === "string"
        ? [[element.pcb_via_id, element.pcb_trace_id] as const]
        : [],
    ),
  );

  return errors.map((error) => {
    const primaryTraceId = error.pcb_trace_id;
    if (
      typeof primaryTraceId === "string" &&
      typeof error.pcb_trace_error_id === "string"
    ) {
      const pairPrefix = `overlap_${primaryTraceId}_`;
      const otherTraceId = error.pcb_trace_error_id.startsWith(pairPrefix)
        ? error.pcb_trace_error_id.slice(pairPrefix.length)
        : undefined;
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
        };
      }
    }

    const viaIds = [
      ...(typeof error.pcb_via_id === "string" ? [error.pcb_via_id] : []),
      ...(Array.isArray(error.pcb_via_ids)
        ? error.pcb_via_ids.filter(
            (viaId): viaId is string => typeof viaId === "string",
          )
        : []),
    ].filter(
      (viaId, viaIndex, allViaIds) => allViaIds.indexOf(viaId) === viaIndex,
    );
    const viaTraceIds = viaIds
      .flatMap((viaId) => {
        const traceId = traceIdByViaId.get(viaId);
        return traceId ? [traceId] : [];
      })
      .filter(
        (traceId, traceIndex, allTraceIds) =>
          allTraceIds.indexOf(traceId) === traceIndex,
      );
    const primaryMovableViaTraceId = viaTraceIds.find((traceId) =>
      newTraceIds.has(traceId),
    );
    if (primaryMovableViaTraceId) {
      const traceIds = [
        primaryMovableViaTraceId,
        ...viaTraceIds,
        ...(typeof primaryTraceId === "string" ? [primaryTraceId] : []),
      ].filter(
        (traceId, traceIndex, allTraceIds) =>
          allTraceIds.indexOf(traceId) === traceIndex,
      );
      return {
        ...error,
        pcb_trace_id: primaryMovableViaTraceId,
        pcb_trace_ids: traceIds,
        pcb_via_ids: viaIds,
      };
    }

    return error;
  });
};
