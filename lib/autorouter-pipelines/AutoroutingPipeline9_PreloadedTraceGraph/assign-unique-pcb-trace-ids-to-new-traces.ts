import type { SimplifiedPcbTrace } from "lib/types";

/**
 * Prevents newly routed traces from accidentally replacing preloaded traces
 * when the joint DRC evaluator combines traces by PCB trace id.
 */
export const assignUniquePcbTraceIdsToNewTraces = (
  newTraces: SimplifiedPcbTrace[],
  preloadedTraces: readonly SimplifiedPcbTrace[],
): SimplifiedPcbTrace[] => {
  const usedPcbTraceIds = new Set(
    preloadedTraces.map((trace) => trace.pcb_trace_id),
  );

  return newTraces.map((trace) => {
    if (!usedPcbTraceIds.has(trace.pcb_trace_id)) {
      usedPcbTraceIds.add(trace.pcb_trace_id);
      return trace;
    }

    const basePcbTraceId = `${trace.pcb_trace_id}_routed`;
    let pcbTraceId = basePcbTraceId;
    let suffix = 2;
    while (usedPcbTraceIds.has(pcbTraceId)) {
      pcbTraceId = `${basePcbTraceId}_${suffix}`;
      suffix += 1;
    }
    usedPcbTraceIds.add(pcbTraceId);
    return {
      ...trace,
      pcb_trace_id: pcbTraceId,
    };
  });
};
