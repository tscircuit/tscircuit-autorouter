import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"

const pointKey = (point: { x: number; y: number; z: number }) =>
  `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`

const routeEndpoints = (route: HighDensityIntraNodeRoute) => [
  route.route[0],
  route.route[route.route.length - 1],
]

const getPortInsideEndCap = ({
  endpoint,
  ports,
  radius,
}: {
  endpoint: Pick<PortPoint, "x" | "y" | "z">
  ports: PortPoint[]
  radius: number
}): PortPoint | undefined => {
  let closest: PortPoint | undefined
  let closestDistance = radius
  for (const port of ports) {
    if (port.z !== endpoint.z) continue
    const distance = Math.hypot(port.x - endpoint.x, port.y - endpoint.y)
    if (distance > closestDistance) continue
    closest = port
    closestDistance = distance
  }
  return closest
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

      let bridgeStartPort: PortPoint | undefined
      let bridgeEndPort: PortPoint | undefined
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
        const startPort = getPortInsideEndCap({
          endpoint: start,
          ports: portPoints,
          radius: route.traceThickness / 2,
        })
        const endPort = getPortInsideEndCap({
          endpoint: end,
          ports: portPoints,
          radius: route.traceThickness / 2,
        })
        const startKey = pointKey(startPort ?? start)
        const endKey = pointKey(endPort ?? end)
        const connectsPort =
          (connectedKeys.has(startKey) && endKey === portPointKey) ||
          (connectedKeys.has(endKey) && startKey === portPointKey) ||
          (targetPortKeys.has(startKey) &&
            targetPortKeys.has(endKey) &&
            (startKey === portPointKey || endKey === portPointKey))
        if (!connectsPort) return false
        bridgeStartPort = startPort
        bridgeEndPort = endPort
        return true
      })

      if (!bridgeRoute) continue

      const bridgePoints = bridgeRoute.route.map((point) => ({
        ...point,
        connectionName,
        rootConnectionName,
      }))
      if (
        bridgeStartPort &&
        pointKey(bridgeStartPort) !== pointKey(bridgePoints[0]!)
      ) {
        bridgePoints.unshift({
          ...bridgeStartPort,
          connectionName,
          rootConnectionName,
        })
      }
      if (
        bridgeEndPort &&
        pointKey(bridgeEndPort) !== pointKey(bridgePoints.at(-1)!)
      ) {
        bridgePoints.push({
          ...bridgeEndPort,
          connectionName,
          rootConnectionName,
        })
      }

      repairedRoutes.push({
        ...bridgeRoute,
        connectionName,
        rootConnectionName,
        route: bridgePoints,
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
