import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { getObstaclesFromSrjTraces } from "lib/utils/convertSrjTracesToObstacles"

/**
 * Materialize immutable routed copper for length-matching clearance checks.
 *
 * Every obstacle carries all aliases on its electrical net so a matcher may
 * leave or enter its own preloaded prefix at a terminal. Rotated trace
 * segments are converted to the axis-aligned approximation expected by the
 * length-matching solver.
 */
export const getLengthMatchingPreloadedTraceObstacles = ({
  srj,
  traces,
  connMap,
}: {
  srj: SimpleRouteJson
  traces: SimplifiedPcbTraces
  connMap: ConnectivityMap
}): Obstacle[] => {
  if (traces.length === 0) return []

  const tracesWithNetAliases = traces.map((trace) => {
    const netId =
      connMap.getNetConnectedToId(trace.connection_name) ??
      trace.connection_name
    return {
      ...trace,
      connectsTo: [
        ...new Set([
          ...(trace.connectsTo ?? []),
          trace.connection_name,
          netId,
          ...connMap.getIdsConnectedToNet(netId),
        ]),
      ],
    }
  })
  const traceObstacles = getObstaclesFromSrjTraces({
    ...srj,
    traces: tracesWithNetAliases,
  })

  return addApproximatingRectsToSrj({
    ...srj,
    connections: [],
    obstacles: traceObstacles,
    traces: undefined,
  }).obstacles
}
