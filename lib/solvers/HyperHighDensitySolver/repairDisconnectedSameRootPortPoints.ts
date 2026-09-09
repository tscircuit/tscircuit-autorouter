import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"

type PhysicalPairKey = string & { readonly __brand: "PhysicalPairKey" }
type ConnectionName = PortPoint["connectionName"]

const pointKey = (point: { x: number; y: number; z: number }) =>
  `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`

const routeEndpoints = (route: HighDensityIntraNodeRoute) => [
  route.route[0],
  route.route[route.route.length - 1],
]

const getPhysicalPairKey = (
  pair: readonly [
    { x: number; y: number; z: number },
    { x: number; y: number; z: number },
  ],
  rootConnectionName: string,
): PhysicalPairKey => {
  const endpointKeys = pair
    .map((point) => JSON.stringify([point.x, point.y, point.z]))
    .sort()
  return JSON.stringify([rootConnectionName, endpointKeys]) as PhysicalPairKey
}

const getExpectedPhysicalPortPointPairs = (
  nodeWithPortPoints: NodeWithPortPoints,
): Array<[PortPoint, PortPoint]> => {
  const explicitPairs = nodeWithPortPoints.portPointsInPairs ?? []
  if (explicitPairs.length > 0) return explicitPairs

  const connectionNames = new Set(
    nodeWithPortPoints.portPoints.map((portPoint) => portPoint.connectionName),
  )
  return [...connectionNames].flatMap((connectionName) =>
    getConnectionPortPointPairs(
      nodeWithPortPoints.portPoints.filter(
        (portPoint) => portPoint.connectionName === connectionName,
      ),
    ),
  )
}

export const doRoutesCoverNodePortPointPairsExactlyOnce = (
  routes: HighDensityIntraNodeRoute[],
  nodeWithPortPoints: NodeWithPortPoints,
): boolean => {
  const remainingPairs = new Map<PhysicalPairKey, Set<ConnectionName>>()
  for (const pair of getExpectedPhysicalPortPointPairs(nodeWithPortPoints)) {
    const [start, end] = pair
    const rootConnectionName = start.rootConnectionName ?? start.connectionName
    if (
      start.connectionName !== end.connectionName ||
      rootConnectionName !== (end.rootConnectionName ?? end.connectionName) ||
      pair.some((point) => ![point.x, point.y, point.z].every(Number.isFinite))
    ) {
      return false
    }
    const pairKey = getPhysicalPairKey(pair, rootConnectionName)
    const connectionNames =
      remainingPairs.get(pairKey) ?? new Set<ConnectionName>()
    connectionNames.add(start.connectionName)
    remainingPairs.set(pairKey, connectionNames)
  }

  for (const route of routes) {
    const [start, end] = routeEndpoints(route)
    if (!start || !end) return false
    if (
      ![start.x, start.y, start.z, end.x, end.y, end.z].every(Number.isFinite)
    ) {
      return false
    }
    const pairKey = getPhysicalPairKey(
      [start, end],
      route.rootConnectionName ?? route.connectionName,
    )
    if (!remainingPairs.get(pairKey)?.has(route.connectionName)) return false
    remainingPairs.delete(pairKey)
  }

  return remainingPairs.size === 0
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
) => {
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
