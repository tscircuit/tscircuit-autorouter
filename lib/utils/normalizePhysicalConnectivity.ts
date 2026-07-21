import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PointId, SimpleRouteJson } from "lib/types"

/**
 * Normalizes the physical connectivity supplied by already-routed traces.
 *
 * The map intentionally excludes the SRJ connections themselves: points in
 * one connection are electrically related, but they are not necessarily
 * joined by existing copper. Only explicit external groups and trace
 * `connectsTo` metadata describe physical routing state.
 */
export const normalizePhysicalConnectivity = (
  srj: SimpleRouteJson,
): SimpleRouteJson => {
  const physicalConnMap = new ConnectivityMap({})

  for (const connection of srj.connections) {
    physicalConnMap.addConnections(connection.externallyConnectedPointIds ?? [])
  }

  for (const trace of srj.traces ?? []) {
    const connectedIds = trace.connectsTo
    if (connectedIds && connectedIds.length >= 2)
      physicalConnMap.addConnections([connectedIds])
  }

  const visiblePointIdsByPhysicalNet = new Map<string, Set<PointId>>()
  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      if (!point.pointId) continue
      const physicalNetId = physicalConnMap.getNetConnectedToId(point.pointId)
      if (!physicalNetId) continue

      const visiblePointIds =
        visiblePointIdsByPhysicalNet.get(physicalNetId) ?? new Set<PointId>()
      visiblePointIds.add(point.pointId)
      visiblePointIdsByPhysicalNet.set(physicalNetId, visiblePointIds)
    }
  }

  const traces = srj.traces?.map((trace) => {
    const connectedIds = trace.connectsTo
    const firstConnectedId = connectedIds?.[0]
    if (!connectedIds || !firstConnectedId) return trace

    const physicalNetId = physicalConnMap.getNetConnectedToId(firstConnectedId)
    const visiblePointIds = physicalNetId
      ? visiblePointIdsByPhysicalNet.get(physicalNetId)
      : undefined
    if (
      !visiblePointIds ||
      !connectedIds.some((connectedId) => visiblePointIds.has(connectedId))
    ) {
      return trace
    }

    return {
      ...trace,
      connectsTo: Array.from(new Set([...connectedIds, ...visiblePointIds])),
    }
  })

  return {
    ...srj,
    ...(traces ? { traces } : {}),
    connections: srj.connections.map((connection) => {
      const pointIdsByPhysicalNet = new Map<string, PointId[]>()

      for (const point of connection.pointsToConnect) {
        if (!point.pointId) continue
        const physicalNetId = physicalConnMap.getNetConnectedToId(point.pointId)
        if (!physicalNetId) continue

        const pointIds = pointIdsByPhysicalNet.get(physicalNetId) ?? []
        pointIds.push(point.pointId)
        pointIdsByPhysicalNet.set(physicalNetId, pointIds)
      }

      const externallyConnectedPointIds = Array.from(
        pointIdsByPhysicalNet.values(),
      ).filter((pointIds) => pointIds.length >= 2)

      return {
        ...connection,
        externallyConnectedPointIds:
          externallyConnectedPointIds.length > 0
            ? externallyConnectedPointIds
            : undefined,
      }
    }),
  }
}
