import type { SimplifiedPcbTrace } from "lib/types"

/** Only explicit replacement metadata removes preloaded copper. */
export const combinePreloadedAndRoutedTraces = (
  preloadedTraces: SimplifiedPcbTrace[],
  routedTraces: SimplifiedPcbTrace[],
): SimplifiedPcbTrace[] => {
  const replacedTraceIds = new Set(
    routedTraces.flatMap((trace) =>
      trace.__replaces_pcb_trace_id ? [trace.__replaces_pcb_trace_id] : [],
    ),
  )
  return [
    ...preloadedTraces.filter(
      (trace) => !replacedTraceIds.has(trace.pcb_trace_id),
    ),
    ...routedTraces,
  ]
}
