import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"

export type Pipeline7PowerTraceExpansionInput = SimpleRouteJson & {
  fixedTraces: SimplifiedPcbTraces
}

export const preparePipeline7PowerTraceExpansionInput = ({
  originalSrj,
  newlyRoutedTraces,
  expandedConnectionNames,
}: {
  originalSrj: SimpleRouteJson
  newlyRoutedTraces: SimplifiedPcbTraces
  expandedConnectionNames: readonly string[]
}): Pipeline7PowerTraceExpansionInput => {
  const expandedConnectionNameSet = new Set(expandedConnectionNames)
  const fixedTraces = (originalSrj.traces ?? []).filter(
    (trace) => !expandedConnectionNameSet.has(trace.connection_name),
  )
  const usedTraceIds = new Set([
    ...newlyRoutedTraces.map((trace) => trace.pcb_trace_id),
    ...fixedTraces.map((trace) => trace.pcb_trace_id),
  ])
  const mutablePreloadedTraces = (originalSrj.traces ?? [])
    .filter((trace) => expandedConnectionNameSet.has(trace.connection_name))
    .map((trace): SimplifiedPcbTrace => {
      const baseTraceId = trace.pcb_trace_id
      let traceId = baseTraceId
      let suffix = 2
      while (usedTraceIds.has(traceId)) {
        traceId = `${baseTraceId}_power_expansion_${suffix++}`
      }
      usedTraceIds.add(traceId)
      return {
        ...trace,
        pcb_trace_id: traceId,
        __replaces_pcb_trace_id: trace.pcb_trace_id,
      }
    })

  return {
    ...originalSrj,
    traces: [...newlyRoutedTraces, ...mutablePreloadedTraces],
    fixedTraces,
  }
}
