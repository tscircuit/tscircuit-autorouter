import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"

type Point3 = { x: number; y: number; z: number }

type SameRootBridgeMatch = {
  route: HighDensityIntraNodeRoute
  routeStart: PortPoint
  routeEnd: PortPoint
  endpointDistance: number
}

const SAME_ROOT_ENDPOINT_EPSILON = 1e-3

const pointKey = (point: { x: number; y: number; z: number }) =>
  `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`

const routeEndpoints = (route: HighDensityIntraNodeRoute) => [
  route.route[0],
  route.route[route.route.length - 1],
]

const getSameLayerDistance = (left: Point3, right: Point3): number => {
  if (left.z !== right.z) return Infinity
  const deltaX = left.x - right.x
  const deltaY = left.y - right.y
  return Math.hypot(deltaX, deltaY)
}

const findSameRootBridgeMatch = ({
  routes,
  connectionName,
  rootConnectionName,
  connectedPortPoints,
  targetPortPoint,
}: {
  routes: HighDensityIntraNodeRoute[]
  connectionName: string
  rootConnectionName: string
  connectedPortPoints: PortPoint[]
  targetPortPoint: PortPoint
}): SameRootBridgeMatch | null => {
  const matches: SameRootBridgeMatch[] = []
  for (const route of routes) {
    if (route.connectionName === connectionName) continue
    if (
      (route.rootConnectionName ?? route.connectionName) !== rootConnectionName
    ) {
      continue
    }
    const [start, end] = routeEndpoints(route)
    if (!start || !end) continue

    for (const connectedPortPoint of connectedPortPoints) {
      const forwardStartDistance = getSameLayerDistance(
        start,
        connectedPortPoint,
      )
      const forwardEndDistance = getSameLayerDistance(end, targetPortPoint)
      const reverseStartDistance = getSameLayerDistance(start, targetPortPoint)
      const reverseEndDistance = getSameLayerDistance(end, connectedPortPoint)
      if (
        Math.max(forwardStartDistance, forwardEndDistance) <=
        SAME_ROOT_ENDPOINT_EPSILON
      ) {
        matches.push({
          route,
          routeStart: connectedPortPoint,
          routeEnd: targetPortPoint,
          endpointDistance: forwardStartDistance + forwardEndDistance,
        })
      }
      if (
        Math.max(reverseStartDistance, reverseEndDistance) <=
        SAME_ROOT_ENDPOINT_EPSILON
      ) {
        matches.push({
          route,
          routeStart: targetPortPoint,
          routeEnd: connectedPortPoint,
          endpointDistance: reverseStartDistance + reverseEndDistance,
        })
      }
    }
  }

  matches.sort(
    (left, right) =>
      left.endpointDistance - right.endpointDistance ||
      left.route.connectionName.localeCompare(right.route.connectionName),
  )
  return matches[0] ?? null
}

const findExactSameRootBridgeRoute = ({
  routes,
  connectionName,
  rootConnectionName,
  connectedKeys,
  targetPortKeys,
  targetPortKey,
}: {
  routes: HighDensityIntraNodeRoute[]
  connectionName: string
  rootConnectionName: string
  connectedKeys: ReadonlySet<string>
  targetPortKeys: ReadonlySet<string>
  targetPortKey: string
}): HighDensityIntraNodeRoute | null => {
  return (
    routes.find((route) => {
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
        (connectedKeys.has(startKey) && endKey === targetPortKey) ||
        (connectedKeys.has(endKey) && startKey === targetPortKey) ||
        (targetPortKeys.has(startKey) &&
          targetPortKeys.has(endKey) &&
          (startKey === targetPortKey || endKey === targetPortKey))
      )
    }) ?? null
  )
}

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

export const areNodePortPointPairsConnectedByRoutes = (
  routes: HighDensityIntraNodeRoute[],
  nodeWithPortPoints: NodeWithPortPoints,
): boolean => {
  const explicitPairs = nodeWithPortPoints.portPointsInPairs ?? []
  if (explicitPairs.length > 0) {
    for (const [start, end] of explicitPairs) {
      const connectedPointKeys = getConnectedPointKeysForConnection(
        routes,
        start.connectionName,
        pointKey(start),
      )
      if (!connectedPointKeys.has(pointKey(end))) return false
    }
    return true
  }

  const portPointsByConnection = new Map<string, PortPoint[]>()
  for (const portPoint of nodeWithPortPoints.portPoints) {
    const connectionPortPoints =
      portPointsByConnection.get(portPoint.connectionName) ?? []
    connectionPortPoints.push(portPoint)
    portPointsByConnection.set(portPoint.connectionName, connectionPortPoints)
  }

  for (const [connectionName, connectionPortPoints] of portPointsByConnection) {
    for (const [start, end] of getConnectionPortPointPairs(
      connectionPortPoints,
    )) {
      const connectedPointKeys = getConnectedPointKeysForConnection(
        routes,
        connectionName,
        pointKey(start),
      )
      if (!connectedPointKeys.has(pointKey(end))) return false
    }
  }

  return true
}

export const repairDisconnectedSameRootPortPoints = (
  routes: HighDensityIntraNodeRoute[],
  nodeWithPortPoints: NodeWithPortPoints,
  allowNearCoincidentEndpoints = false,
): HighDensityIntraNodeRoute[] => {
  const repairedRoutes = [...routes]
  const portPointsByConnection = new Map<string, PortPoint[]>()

  for (const portPoint of nodeWithPortPoints.portPoints) {
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

      if (!allowNearCoincidentEndpoints) {
        const bridgeRoute = findExactSameRootBridgeRoute({
          routes: repairedRoutes,
          connectionName,
          rootConnectionName,
          connectedKeys,
          targetPortKeys,
          targetPortKey: portPointKey,
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
        continue
      }

      const connectedPortPoints = portPoints.filter((candidatePortPoint) =>
        connectedKeys.has(pointKey(candidatePortPoint)),
      )
      const bridgeMatch = findSameRootBridgeMatch({
        routes: repairedRoutes,
        connectionName,
        rootConnectionName,
        connectedPortPoints,
        targetPortPoint: portPoint,
      })
      if (!bridgeMatch) continue

      const repairedRoutePoints = bridgeMatch.route.route.map((point) => ({
        ...point,
        connectionName,
        rootConnectionName,
      }))
      repairedRoutePoints[0] = {
        ...repairedRoutePoints[0]!,
        ...bridgeMatch.routeStart,
        connectionName,
        rootConnectionName,
      }
      repairedRoutePoints[repairedRoutePoints.length - 1] = {
        ...repairedRoutePoints.at(-1)!,
        ...bridgeMatch.routeEnd,
        connectionName,
        rootConnectionName,
      }

      repairedRoutes.push({
        ...bridgeMatch.route,
        connectionName,
        rootConnectionName,
        route: repairedRoutePoints,
        vias: bridgeMatch.route.vias.map((via) => ({ ...via })),
        jumpers: bridgeMatch.route.jumpers?.map((jumper) => ({
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
