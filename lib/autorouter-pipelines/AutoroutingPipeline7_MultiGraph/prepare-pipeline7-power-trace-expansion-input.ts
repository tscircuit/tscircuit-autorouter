import {
  ConnectionNameResolver,
  type PowerTraceExpanderInput,
} from "@tscircuit/power-trace-expander"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import { getPreferredClearanceSrj } from "lib/utils/getPreferredClearanceSrj"

export type Pipeline7PowerTraceExpansionInput = SimpleRouteJson & {
  fixedTraces: SimplifiedPcbTraces
}

export const preparePipeline7PowerTraceExpansionInput = ({
  originalSrj,
  newlyRoutedTraces,
  currentPreloadedTraces,
  expandedConnectionNames,
  resolveConnectedTraceAliases = false,
}: {
  originalSrj: SimpleRouteJson
  newlyRoutedTraces: SimplifiedPcbTraces
  currentPreloadedTraces?: SimplifiedPcbTraces
  expandedConnectionNames: readonly string[]
  resolveConnectedTraceAliases?: boolean
}): Pipeline7PowerTraceExpansionInput => {
  const preloadedTraces = currentPreloadedTraces ?? originalSrj.traces ?? []
  const mutablePreloadedTraceSet = resolveConnectedTraceAliases
    ? getConnectedMutablePreloadedTraces({
        originalSrj,
        newlyRoutedTraces,
        preloadedTraces,
        expandedConnectionNames,
      })
    : new Set(
        preloadedTraces.filter((trace) =>
          expandedConnectionNames.includes(trace.connection_name),
        ),
      )
  const fixedTraces = preloadedTraces.filter(
    (trace) => !mutablePreloadedTraceSet.has(trace),
  )
  const usedTraceIds = new Set([
    ...newlyRoutedTraces.map((trace) => trace.pcb_trace_id),
    ...fixedTraces.map((trace) => trace.pcb_trace_id),
  ])
  const mutablePreloadedTraces = preloadedTraces
    .filter((trace) => mutablePreloadedTraceSet.has(trace))
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
        __replaces_pcb_trace_id:
          trace.__replaces_pcb_trace_id ?? trace.pcb_trace_id,
      }
    })

  return {
    ...getPreferredClearanceSrj(originalSrj),
    traces: [...newlyRoutedTraces, ...mutablePreloadedTraces],
    fixedTraces,
  }
}

const getConnectedMutablePreloadedTraces = ({
  originalSrj,
  newlyRoutedTraces,
  preloadedTraces,
  expandedConnectionNames,
}: {
  originalSrj: SimpleRouteJson
  newlyRoutedTraces: SimplifiedPcbTraces
  preloadedTraces: SimplifiedPcbTraces
  expandedConnectionNames: readonly string[]
}): Set<SimplifiedPcbTrace> => {
  const preloadedTraceIds = new Set(
    preloadedTraces.map((trace) => trace.pcb_trace_id),
  )
  const resolverTraceIds = new Set([
    ...preloadedTraceIds,
    ...newlyRoutedTraces.map((trace) => trace.pcb_trace_id),
  ])
  const resolverNewlyRoutedTraces = newlyRoutedTraces.map((trace, index) => {
    if (!preloadedTraceIds.has(trace.pcb_trace_id)) return trace

    const baseTraceId = `__pipeline7_new_trace_${index}_${trace.pcb_trace_id}`
    let resolverTraceId = baseTraceId
    let suffix = 2
    while (resolverTraceIds.has(resolverTraceId)) {
      resolverTraceId = `${baseTraceId}_${suffix++}`
    }
    resolverTraceIds.add(resolverTraceId)
    return { ...trace, pcb_trace_id: resolverTraceId }
  })
  const connectionNameResolver = new ConnectionNameResolver({
    ...originalSrj,
    traces: [...resolverNewlyRoutedTraces, ...preloadedTraces],
  } as unknown as PowerTraceExpanderInput)
  const expandedConnectionNameSet = new Set(
    connectionNameResolver.canonicalize([...expandedConnectionNames]),
  )
  return new Set(
    preloadedTraces.filter((trace) =>
      connectionNameResolver
        .canonicalize([trace.connection_name])
        .some((name) => expandedConnectionNameSet.has(name)),
    ),
  )
}
