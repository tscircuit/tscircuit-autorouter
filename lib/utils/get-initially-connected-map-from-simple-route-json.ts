import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "lib/types"

const SHARED_LOGICAL_NET_ID_PATTERN =
  /^(source_trace_|source_net_|connectivity_net)/

const getSharedLogicalConnectionIds = (srj: SimpleRouteJson): Set<string> => {
  const endpointIds = new Set<string>()
  const sharedLogicalIds = new Set<string>()

  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      if (point.pointId) endpointIds.add(point.pointId)
      if (point.pcb_port_id) endpointIds.add(point.pcb_port_id)
    }
    for (const group of connection.externallyConnectedPointIds ?? []) {
      for (const pointId of group) {
        if (pointId) endpointIds.add(pointId)
      }
    }

    for (const logicalId of [
      connection.name,
      connection.source_trace_id,
      connection.rootConnectionName,
      connection.netConnectionName,
      connection.__netConnectionName,
      ...(connection.mergedConnectionNames ?? []),
      ...(connection.__rootConnectionNames ?? []),
    ]) {
      if (logicalId) sharedLogicalIds.add(logicalId)
    }
  }

  for (const trace of srj.traces ?? []) {
    const traceSourceTraceId = (
      trace as { source_trace_id?: string | undefined }
    ).source_trace_id
    for (const logicalId of [trace.connection_name, traceSourceTraceId]) {
      if (logicalId) sharedLogicalIds.add(logicalId)
    }
  }

  for (const endpointId of endpointIds) {
    sharedLogicalIds.delete(endpointId)
  }

  return sharedLogicalIds
}

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
  const sharedLogicalIds = getSharedLogicalConnectionIds(srj)

  for (const connection of srj.connections) {
    const connectedPointGroups = connection.externallyConnectedPointIds ?? []
    initiallyConnectedMap.addConnections(connectedPointGroups)
  }

  for (const trace of srj.traces ?? []) {
    const connectedIds = (trace.connectsTo ?? []).filter(
      (id) =>
        Boolean(id) &&
        !sharedLogicalIds.has(id) &&
        !SHARED_LOGICAL_NET_ID_PATTERN.test(id),
    )
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
