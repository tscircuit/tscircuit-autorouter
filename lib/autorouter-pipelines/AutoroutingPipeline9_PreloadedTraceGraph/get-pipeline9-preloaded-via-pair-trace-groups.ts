import type { AnyCircuitElement } from "circuit-json";

export const getPipeline9PreloadedViaPairTraceGroups = ({
  errors,
  circuitJson,
  originalTraceIdByPreparedTraceId,
}: {
  errors: Array<Record<string, unknown>>;
  circuitJson: AnyCircuitElement[];
  originalTraceIdByPreparedTraceId: ReadonlyMap<string, string>;
}): string[][] => {
  const preparedTraceIdByViaId = new Map(
    circuitJson.flatMap((element) =>
      element.type === "pcb_via" &&
      typeof element.pcb_via_id === "string" &&
      typeof element.pcb_trace_id === "string"
        ? [[element.pcb_via_id, element.pcb_trace_id] as const]
        : [],
    ),
  );

  return errors.flatMap((error) => {
    if (
      error.type !== "pcb_via_clearance_error" ||
      !Array.isArray(error.pcb_via_ids) ||
      typeof error.actual_clearance !== "number" ||
      error.actual_clearance >= 0
    )
      return [];
    const originalTraceIds = error.pcb_via_ids
      .flatMap((viaId) => {
        if (typeof viaId !== "string") return [];
        const preparedTraceId = preparedTraceIdByViaId.get(viaId);
        if (!preparedTraceId) return [];
        return [
          originalTraceIdByPreparedTraceId.get(preparedTraceId) ??
            preparedTraceId,
        ];
      })
      .filter(
        (traceId, traceIndex, allTraceIds) =>
          allTraceIds.indexOf(traceId) === traceIndex,
      );
    return originalTraceIds.length > 0 ? [originalTraceIds] : [];
  });
};
