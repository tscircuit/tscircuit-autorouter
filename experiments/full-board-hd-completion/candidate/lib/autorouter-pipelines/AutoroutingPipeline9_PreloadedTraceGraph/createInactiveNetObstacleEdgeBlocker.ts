import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import type { SharedEdgeLayerBlocker } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { NetId, Obstacle, SimpleRouteJson, TraceId } from "lib/types"
import { getPointToObstacleDistance } from "lib/utils/getPointToObstacleDistance"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type InactiveNetObstacle = {
  obstacle: Obstacle
  z: number
}

/**
 * Certifies board-world shared edges wholly inside inactive copper's clearance.
 * Circle and rounded-rectangle clearance envelopes are convex, so both strict
 * endpoint tests certify every point on the edge rather than sampling it.
 */
export function createInactiveNetObstacleEdgeBlocker({
  srj,
  connMap,
  traceWidth,
}: {
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  traceWidth: number
}): SharedEdgeLayerBlocker {
  const getCanonicalNetId = (connectedId: NetId | TraceId): NetId | undefined => {
    const netId = connMap.getNetConnectedToId(connectedId)
    if (netId !== undefined) return netId
    if (connMap.netMap[connectedId]) return connectedId
    return undefined
  }
  const activeNetIds = new Set<NetId>()
  const routedConnectionNames = [
    ...srj.connections.map((connection) => connection.name),
    ...(srj.traces ?? []).map((trace) => trace.connection_name),
  ]
  for (const connectionName of routedConnectionNames) {
    const netId = getCanonicalNetId(connectionName)
    if (netId === undefined) {
      throw new Error(
        `Could not resolve the net for routed connection "${connectionName}"`,
      )
    }
    activeNetIds.add(netId)
  }

  // Changed preload sections can route narrower wires than the current phase.
  // A hard blocker must exclude even the narrowest wire that can be emitted.
  let minimumWireWidth = traceWidth
  for (const trace of srj.traces ?? []) {
    for (const point of trace.route) {
      if (
        (point.route_type === "wire" ||
          point.route_type === "through_obstacle") &&
        point.width > 0
      ) {
        minimumWireWidth = Math.min(minimumWireWidth, point.width)
      }
    }
  }
  const clearance =
    minimumWireWidth / 2 +
    (srj.minTraceToPadEdgeClearance ?? srj.defaultObstacleMargin ?? 0.15)
  const inactiveObstacles: InactiveNetObstacle[] = []
  for (const obstacle of srj.obstacles) {
    if (
      obstacle.isCopperPour ||
      obstacle.isNonPlatedHole ||
      obstacle.connectedTo.length === 0
    ) {
      continue
    }
    const zLayers = [
      ...new Set(
        obstacle.__zLayers ??
          obstacle.zLayers ??
          obstacle.layers.map((layer) => mapLayerNameToZ(layer, srj.layerCount)),
      ),
    ]
    if (zLayers.length !== 1) continue
    const obstacleNetIds = obstacle.connectedTo.map(getCanonicalNetId)
    if (
      obstacleNetIds.some(
        (netId) => netId === undefined || activeNetIds.has(netId),
      )
    ) {
      continue
    }
    inactiveObstacles.push({ obstacle, z: zLayers[0]! })
  }
  if (inactiveObstacles.length === 0) return (): boolean => false

  const index = new FlatbushIndex<InactiveNetObstacle>(inactiveObstacles.length)
  for (const entry of inactiveObstacles) {
    const { obstacle } = entry
    const rotation = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const cosine = Math.abs(Math.cos(rotation))
    const sine = Math.abs(Math.sin(rotation))
    const halfWidth =
      obstacle.shape === "circle"
        ? obstacle.width / 2
        : (cosine * obstacle.width + sine * obstacle.height) / 2
    const halfHeight =
      obstacle.shape === "circle"
        ? obstacle.width / 2
        : (sine * obstacle.width + cosine * obstacle.height) / 2
    index.insert(
      entry,
      obstacle.center.x - halfWidth - clearance,
      obstacle.center.y - halfHeight - clearance,
      obstacle.center.x + halfWidth + clearance,
      obstacle.center.y + halfHeight + clearance,
    )
  }
  index.finish()

  return (edge, z): boolean =>
    index
      .search(edge.start.x, edge.start.y, edge.start.x, edge.start.y)
      .some(
        (entry) =>
          entry.z === z &&
          getPointToObstacleDistance(edge.start, entry.obstacle) + 1e-9 <
            clearance &&
          getPointToObstacleDistance(edge.end, entry.obstacle) + 1e-9 <
            clearance,
      )
}
