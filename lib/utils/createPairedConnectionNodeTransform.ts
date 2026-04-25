import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

type RoutePoint = HighDensityIntraNodeRoute["route"][number] & {
  connectionName?: string
  rootConnectionName?: string
}

type NodeTransformResult = {
  nodeWithPortPoints: NodeWithPortPoints
  restoreRoute: (route: HighDensityIntraNodeRoute) => HighDensityIntraNodeRoute
}

const SYNTHETIC_PAIR_SEPARATOR = "::__pair_"

const isDisjointCompletePairing = (
  portPoints: PortPoint[],
  pairs: NonNullable<NodeWithPortPoints["portPointPairs"]>,
) => {
  if (portPoints.length <= 2 || pairs.length === 0) return false

  const pointIds = new Set<string>()
  for (const portPoint of portPoints) {
    if (!portPoint.portPointId) return false
    pointIds.add(portPoint.portPointId)
  }

  const countsByPortPointId = new Map<string, number>()
  for (const pair of pairs) {
    const [a, b] = pair.portPointIds
    if (!pointIds.has(a) || !pointIds.has(b) || a === b) {
      return false
    }
    countsByPortPointId.set(a, (countsByPortPointId.get(a) ?? 0) + 1)
    countsByPortPointId.set(b, (countsByPortPointId.get(b) ?? 0) + 1)
  }

  if (countsByPortPointId.size !== pointIds.size) return false
  if (pairs.length * 2 !== portPoints.length) return false

  return Array.from(countsByPortPointId.values()).every((count) => count === 1)
}

export const createPairedConnectionNodeTransform = (
  node: NodeWithPortPoints,
): NodeTransformResult => {
  if (!node.portPointPairs || node.portPointPairs.length === 0) {
    return {
      nodeWithPortPoints: node,
      restoreRoute: (route) => route,
    }
  }

  const portPointsByConnection = new Map<string, PortPoint[]>()
  for (const portPoint of node.portPoints) {
    if (!portPointsByConnection.has(portPoint.connectionName)) {
      portPointsByConnection.set(portPoint.connectionName, [])
    }
    portPointsByConnection.get(portPoint.connectionName)!.push(portPoint)
  }

  const pairsByConnection = new Map<
    string,
    NonNullable<NodeWithPortPoints["portPointPairs"]>
  >()
  for (const pair of node.portPointPairs) {
    if (!pairsByConnection.has(pair.connectionName)) {
      pairsByConnection.set(pair.connectionName, [])
    }
    pairsByConnection.get(pair.connectionName)!.push(pair)
  }

  const syntheticToOriginalConnection = new Map<string, string>()
  const transformedConnections = new Set<string>()
  const transformedPortPoints: PortPoint[] = []
  let syntheticPairIndex = 0

  for (const [connectionName, portPoints] of portPointsByConnection) {
    const connectionPairs = pairsByConnection.get(connectionName) ?? []
    if (!isDisjointCompletePairing(portPoints, connectionPairs)) {
      transformedPortPoints.push(...portPoints)
      continue
    }

    transformedConnections.add(connectionName)
    const pointById = new Map(
      portPoints.map((portPoint) => [portPoint.portPointId!, portPoint]),
    )

    for (const pair of connectionPairs) {
      const a = pointById.get(pair.portPointIds[0])
      const b = pointById.get(pair.portPointIds[1])
      if (!a || !b) continue

      const syntheticConnectionName = `${connectionName}${SYNTHETIC_PAIR_SEPARATOR}${syntheticPairIndex++}`
      syntheticToOriginalConnection.set(syntheticConnectionName, connectionName)

      transformedPortPoints.push(
        {
          ...a,
          connectionName: syntheticConnectionName,
          rootConnectionName: a.rootConnectionName ?? connectionName,
        },
        {
          ...b,
          connectionName: syntheticConnectionName,
          rootConnectionName: b.rootConnectionName ?? connectionName,
        },
      )
    }
  }

  if (syntheticToOriginalConnection.size === 0) {
    return {
      nodeWithPortPoints: node,
      restoreRoute: (route) => route,
    }
  }

  const remainingPortPointPairs = node.portPointPairs.filter(
    (pair) => !transformedConnections.has(pair.connectionName),
  )

  return {
    nodeWithPortPoints: {
      ...node,
      portPoints: transformedPortPoints,
      portPointPairs:
        remainingPortPointPairs.length > 0
          ? remainingPortPointPairs
          : undefined,
    },
    restoreRoute: (route) => {
      const originalConnectionName = syntheticToOriginalConnection.get(
        route.connectionName,
      )
      if (!originalConnectionName) return route

      return {
        ...route,
        connectionName: originalConnectionName,
        rootConnectionName: route.rootConnectionName ?? originalConnectionName,
        route: route.route.map((point) => {
          const nextPoint = { ...point } as RoutePoint
          if (nextPoint.connectionName) {
            nextPoint.connectionName = originalConnectionName
          }
          if (nextPoint.rootConnectionName == null) {
            nextPoint.rootConnectionName =
              route.rootConnectionName ?? originalConnectionName
          }
          return nextPoint
        }),
      }
    },
  }
}
