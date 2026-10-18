import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

export type SharedCopperNodeRoutingPlan = {
  originalNode: NodeWithPortPoints
  routingNode: NodeWithPortPoints
  connectionNamesByRepresentative: Map<string, string[]>
  sharedConnectionCount: number
}

const getPortPointCopperKey = (point: PortPoint): string =>
  JSON.stringify([
    point.portPointId,
    point.x,
    point.y,
    point.z,
    point.pcb_port_id,
  ])

/** Identical same-net MST hops are one physical routing demand. */
export const createSharedCopperNodeRoutingPlan = (
  node: NodeWithPortPoints,
  connMap: ConnectivityMap,
): SharedCopperNodeRoutingPlan => {
  const pointsByConnection = new Map<string, PortPoint[]>()
  for (const point of node.portPoints) {
    const points = pointsByConnection.get(point.connectionName)
    if (points) points.push(point)
    else pointsByConnection.set(point.connectionName, [point])
  }

  const representativeByCopperKey = new Map<string, string>()
  const connectionNamesByRepresentative = new Map<string, string[]>()
  let sharedConnectionCount = 0
  for (const [connectionName, points] of pointsByConnection) {
    const root = points[0]!.rootConnectionName ?? connectionName
    const net = connMap.getNetConnectedToId(root) ?? root
    const endpointKeys = [...new Set(points.map(getPortPointCopperKey))].sort()
    const pairKeys = node.portPointsInPairs
      ?.filter(([start]) => start.connectionName === connectionName)
      .map((pair) => JSON.stringify(pair.map(getPortPointCopperKey).sort()))
      .sort()
    // A route may revisit one region on another layer. Share the complete
    // repeated hop set only when its pairings agree, not just its port set.
    const hasPairedCopper =
      endpointKeys.length === 2 ||
      (endpointKeys.length > 2 && pairKeys !== undefined && pairKeys.length > 0)
    const copperKey = hasPairedCopper
      ? JSON.stringify([net, endpointKeys, pairKeys])
      : JSON.stringify([connectionName, net, endpointKeys])
    const representative = representativeByCopperKey.get(copperKey)
    if (representative !== undefined) {
      connectionNamesByRepresentative.get(representative)!.push(connectionName)
      sharedConnectionCount++
    } else {
      representativeByCopperKey.set(copperKey, connectionName)
      connectionNamesByRepresentative.set(connectionName, [connectionName])
    }
  }

  return {
    originalNode: node,
    routingNode: {
      ...node,
      portPoints: node.portPoints.filter((point) =>
        connectionNamesByRepresentative.has(point.connectionName),
      ),
      portPointsInPairs: node.portPointsInPairs?.filter(([start]) =>
        connectionNamesByRepresentative.has(start.connectionName),
      ),
    },
    connectionNamesByRepresentative,
    sharedConnectionCount,
  }
}
