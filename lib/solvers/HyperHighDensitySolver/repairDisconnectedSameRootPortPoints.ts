import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getPortPointsFromNodeWithPortPoints } from "lib/utils/getPortPointsFromNodeWithPortPoints"

const pointKey = (point: { x: number; y: number; z: number }) =>
  `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`

const routeEndpoints = (route: HighDensityIntraNodeRoute) => [
  route.route[0],
  route.route[route.route.length - 1],
]

const getConnectedPointKeysForConnection = (
  routes: HighDensityIntraNodeRoute[],
  connectionName: string,
  startKey: string,
) => {
  const adjacency = new Map<string, Set<string>>()
  const addEdge = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set())
    if (!adjacency.has(b)) adjacency.set(b, new Set())
    adjacency.get(a)!.add(b)
    adjacency.get(b)!.add(a)
  }

  for (const route of routes) {
    if (route.connectionName !== connectionName || route.route.length === 0) {
      continue
    }
    if (route.route.length === 1) {
      const key = pointKey(route.route[0]!)
      if (!adjacency.has(key)) adjacency.set(key, new Set())
      continue
    }
    for (let i = 0; i < route.route.length - 1; i++) {
      addEdge(pointKey(route.route[i]!), pointKey(route.route[i + 1]!))
    }
  }

  const connected = new Set<string>([startKey])
  const stack = [startKey]
  while (stack.length > 0) {
    const key = stack.pop()!
    for (const nextKey of adjacency.get(key) ?? []) {
      if (connected.has(nextKey)) continue
      connected.add(nextKey)
      stack.push(nextKey)
    }
  }

  return connected
}

export const repairDisconnectedSameRootPortPoints = (
  routes: HighDensityIntraNodeRoute[],
  nodeWithPortPoints: NodeWithPortPoints,
) => {
  const repairedRoutes = [...routes]
  const portPointsByConnection = new Map<string, PortPoint[]>()

  for (const portPoint of getPortPointsFromNodeWithPortPoints(
    nodeWithPortPoints,
  )) {
    const portPoints =
      portPointsByConnection.get(portPoint.connectionName) ?? []
    portPoints.push(portPoint)
    portPointsByConnection.set(portPoint.connectionName, portPoints)
  }

  for (const [connectionName, portPoints] of portPointsByConnection) {
    if (portPoints.length <= 1) continue

    const rootConnectionName =
      portPoints[0]?.rootConnectionName ?? connectionName
    const targetPortKeys = new Set(portPoints.map(pointKey))
    let connectedKeys = getConnectedPointKeysForConnection(
      repairedRoutes,
      connectionName,
      pointKey(portPoints[0]!),
    )

    for (const portPoint of portPoints.slice(1)) {
      const portPointKey = pointKey(portPoint)
      if (connectedKeys.has(portPointKey)) continue

      const bridgeRoute = repairedRoutes.find((route) => {
        if (
          (route.rootConnectionName ?? route.connectionName) !==
          rootConnectionName
        ) {
          return false
        }
        if (route.connectionName === connectionName) return false
        const [start, end] = routeEndpoints(route)
        if (!start || !end) return false
        const startKey = pointKey(start)
        const endKey = pointKey(end)
        return (
          (connectedKeys.has(startKey) && endKey === portPointKey) ||
          (connectedKeys.has(endKey) && startKey === portPointKey) ||
          (targetPortKeys.has(startKey) &&
            targetPortKeys.has(endKey) &&
            (startKey === portPointKey || endKey === portPointKey))
        )
      })

      if (!bridgeRoute) continue

      repairedRoutes.push({
        ...bridgeRoute,
        connectionName,
        rootConnectionName,
        route: bridgeRoute.route.map((point) => ({
          ...point,
          connectionName,
          rootConnectionName,
        })),
        vias: bridgeRoute.vias.map((via) => ({ ...via })),
        jumpers: bridgeRoute.jumpers?.map((jumper) => ({
          ...jumper,
          start: { ...jumper.start },
          end: { ...jumper.end },
        })),
      })

      connectedKeys = getConnectedPointKeysForConnection(
        repairedRoutes,
        connectionName,
        pointKey(portPoints[0]!),
      )
    }
  }

  return repairedRoutes
}
