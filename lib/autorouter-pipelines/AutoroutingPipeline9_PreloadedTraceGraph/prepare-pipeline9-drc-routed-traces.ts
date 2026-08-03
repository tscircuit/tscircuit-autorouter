import type { SimplifiedPcbTrace } from "lib/types"

export type PreparedPipeline9DrcRoutedTraces = {
  routedTraces: SimplifiedPcbTrace[]
  originalPreloadedTraceIdByPreparedTraceId: Map<string, string>
}

/**
 * Keeps candidate trace ids aligned with the DRC repair solver while retaining
 * preloaded copper whose id collides with a new point-pair trace.
 */
export const preparePipeline9DrcRoutedTracesWithMetadata = ({
  originalPreloadedTraces,
  mutatedPreloadedTraces,
  newTraces,
}: {
  originalPreloadedTraces: readonly SimplifiedPcbTrace[]
  mutatedPreloadedTraces: readonly SimplifiedPcbTrace[]
  newTraces: SimplifiedPcbTrace[]
}): PreparedPipeline9DrcRoutedTraces => {
  const newTraceIds = new Set(newTraces.map((trace) => trace.pcb_trace_id))
  const mutatedPreloadedTraceById = new Map(
    mutatedPreloadedTraces.map((trace) => [trace.pcb_trace_id, trace]),
  )
  const usedTraceIds = new Set([
    ...originalPreloadedTraces.map((trace) => trace.pcb_trace_id),
    ...newTraceIds,
  ])
  const originalPreloadedTraceIdByPreparedTraceId = new Map<string, string>()
  const preloadedCollisionCopies = originalPreloadedTraces
    .filter((trace) => newTraceIds.has(trace.pcb_trace_id))
    .map((trace) => {
      const currentTrace =
        mutatedPreloadedTraceById.get(trace.pcb_trace_id) ?? trace
      const baseId = `${trace.pcb_trace_id}_preloaded`
      let pcbTraceId = baseId
      let suffix = 2
      while (usedTraceIds.has(pcbTraceId)) {
        pcbTraceId = `${baseId}_${suffix}`
        suffix += 1
      }
      usedTraceIds.add(pcbTraceId)
      originalPreloadedTraceIdByPreparedTraceId.set(
        pcbTraceId,
        trace.pcb_trace_id,
      )
      return { ...currentTrace, pcb_trace_id: pcbTraceId }
    })
  const nonCollidingMutatedPreloadedTraces = mutatedPreloadedTraces.filter(
    (trace) => !newTraceIds.has(trace.pcb_trace_id),
  )

  return {
    routedTraces: [
      ...preloadedCollisionCopies,
      ...nonCollidingMutatedPreloadedTraces,
      ...newTraces,
    ],
    originalPreloadedTraceIdByPreparedTraceId,
  }
}

export const preparePipeline9DrcRoutedTraces = (
  options: Parameters<typeof preparePipeline9DrcRoutedTracesWithMetadata>[0],
): SimplifiedPcbTrace[] =>
  preparePipeline9DrcRoutedTracesWithMetadata(options).routedTraces
