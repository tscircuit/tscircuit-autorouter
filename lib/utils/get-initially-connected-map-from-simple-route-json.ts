import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "lib/types"

/**
 * Builds connectivity established before autorouting begins.
 *
 * Connection names are intentionally excluded because they describe which
 * points must eventually share a net, not which points are already connected.
 */
export const getInitiallyConnectedMapFromSimpleRouteJson = (
  srj: SimpleRouteJson,
): ConnectivityMap => {
  const initiallyConnectedMap = new ConnectivityMap({})

  for (const connection of srj.connections) {
    const connectedPointGroups = connection.externallyConnectedPointIds ?? []
    initiallyConnectedMap.addConnections(connectedPointGroups)
  }

  for (const trace of srj.traces ?? []) {
    const connectedIds = trace.connectsTo ?? []
    if (connectedIds.length === 0) continue
    initiallyConnectedMap.addConnections([
      [trace.pcb_trace_id, ...connectedIds],
    ])
  }

  return initiallyConnectedMap
}

export const areIdsInitiallyConnected = (
  initiallyConnectedMap: ConnectivityMap,
  firstId: string,
  secondId: string,
): boolean => {
  const initiallyConnectedNet =
    initiallyConnectedMap.getNetConnectedToId(firstId)
  if (!initiallyConnectedNet) return false
  return (
    initiallyConnectedNet ===
    initiallyConnectedMap.getNetConnectedToId(secondId)
  )
}
