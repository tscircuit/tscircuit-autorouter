import type {
  PointKey,
  SimpleRouteConnection,
  SimplifiedPcbTraces,
} from "lib/types"
import { getPointKey } from "lib/utils/getPointKey"

export interface MaxViaCountViolation {
  connectionName: string
  actualViaCount: number
  maxViaCount: number
}

interface RouteGraphEdge {
  edgeId: string
  from: PointKey
  to: PointKey
  viaCount: number
  rootConnectionNames: readonly string[]
}

interface RouteGraphNeighbor {
  edgeId: string
  point: PointKey
  viaCount: number
}

const buildRouteGraphEdges = ({
  constrainedConnectionNames,
  routedConnections,
  traces,
}: {
  constrainedConnectionNames: ReadonlySet<string>
  routedConnections: readonly SimpleRouteConnection[]
  traces: SimplifiedPcbTraces
}): RouteGraphEdge[] => {
  const viaCountByRoutedConnectionName = new Map<string, number>()

  for (const trace of traces) {
    const routedConnection = routedConnections
      .filter((candidate) =>
        trace.pcb_trace_id.startsWith(`${candidate.name}_`),
      )
      .sort((a, b) => b.name.length - a.name.length)[0]
    if (!routedConnection) continue

    const traceViaCount = trace.route.filter(
      (routePoint) => routePoint.route_type === "via",
    ).length
    viaCountByRoutedConnectionName.set(
      routedConnection.name,
      (viaCountByRoutedConnectionName.get(routedConnection.name) ?? 0) +
        traceViaCount,
    )
  }

  const edges: RouteGraphEdge[] = []
  for (const routedConnection of routedConnections) {
    const rootConnectionNames = routedConnection.__rootConnectionNames ?? [
      routedConnection.name,
    ]
    if (
      !rootConnectionNames.some((connectionName) =>
        constrainedConnectionNames.has(connectionName),
      )
    )
      continue
    if (routedConnection.pointsToConnect.length !== 2) {
      throw new Error(
        `Cannot evaluate maxViaCount: routed connection "${routedConnection.name}" has ${routedConnection.pointsToConnect.length} points`,
      )
    }
    if (!viaCountByRoutedConnectionName.has(routedConnection.name)) {
      throw new Error(
        `Cannot evaluate maxViaCount: routed connection "${routedConnection.name}" has no output trace`,
      )
    }

    const [from, to] = routedConnection.pointsToConnect
    edges.push({
      edgeId: routedConnection.name,
      from: getPointKey(from),
      to: getPointKey(to),
      viaCount: viaCountByRoutedConnectionName.get(routedConnection.name) ?? 0,
      rootConnectionNames,
    })
  }

  return edges
}

const getShortestPathEdgeIds = ({
  adjacency,
  connectionName,
  from,
  to,
}: {
  adjacency: ReadonlyMap<PointKey, readonly RouteGraphNeighbor[]>
  connectionName: string
  from: PointKey
  to: PointKey
}): string[] => {
  const distances = new Map<PointKey, number>([[from, 0]])
  const previous = new Map<PointKey, { edgeId: string; point: PointKey }>()
  const unvisited = new Set(adjacency.keys())

  while (unvisited.size > 0) {
    let currentPointKey: PointKey | undefined
    let currentDistance = Number.POSITIVE_INFINITY
    for (const pointKey of unvisited) {
      const distance = distances.get(pointKey) ?? Number.POSITIVE_INFINITY
      if (distance >= currentDistance) continue
      currentPointKey = pointKey
      currentDistance = distance
    }
    if (currentPointKey === undefined || currentPointKey === to) break

    unvisited.delete(currentPointKey)
    for (const neighbor of adjacency.get(currentPointKey) ?? []) {
      if (!unvisited.has(neighbor.point)) continue
      const nextDistance = currentDistance + neighbor.viaCount
      if (
        nextDistance >=
        (distances.get(neighbor.point) ?? Number.POSITIVE_INFINITY)
      )
        continue
      distances.set(neighbor.point, nextDistance)
      previous.set(neighbor.point, {
        edgeId: neighbor.edgeId,
        point: currentPointKey,
      })
    }
  }

  if (!distances.has(to)) {
    throw new Error(
      `Cannot evaluate maxViaCount for connection "${connectionName}": routed output does not connect all original points`,
    )
  }

  const edgeIds: string[] = []
  let currentPointKey = to
  while (currentPointKey !== from) {
    const precedingStep = previous.get(currentPointKey)
    if (!precedingStep) {
      throw new Error(
        `Cannot evaluate maxViaCount for connection "${connectionName}": routed path metadata is incomplete`,
      )
    }
    edgeIds.push(precedingStep.edgeId)
    currentPointKey = precedingStep.point
  }

  return edgeIds
}

const getViaCountForOriginalConnection = ({
  connection,
  routeGraphEdges,
}: {
  connection: SimpleRouteConnection
  routeGraphEdges: readonly RouteGraphEdge[]
}): number => {
  const terminalPointKeys = Array.from(
    new Set(connection.pointsToConnect.map((point) => getPointKey(point))),
  )
  if (terminalPointKeys.length <= 1) return 0

  const adjacency = new Map<PointKey, RouteGraphNeighbor[]>()
  const connectionEdges = routeGraphEdges.filter((edge) =>
    edge.rootConnectionNames.includes(connection.name),
  )
  for (const edge of connectionEdges) {
    adjacency.set(edge.from, [
      ...(adjacency.get(edge.from) ?? []),
      { edgeId: edge.edgeId, point: edge.to, viaCount: edge.viaCount },
    ])
    adjacency.set(edge.to, [
      ...(adjacency.get(edge.to) ?? []),
      { edgeId: edge.edgeId, point: edge.from, viaCount: edge.viaCount },
    ])
  }

  const usedEdgeIds = new Set<string>()
  const firstTerminalPointKey = terminalPointKeys[0]!
  for (const targetPointKey of terminalPointKeys.slice(1)) {
    for (const edgeId of getShortestPathEdgeIds({
      adjacency,
      connectionName: connection.name,
      from: firstTerminalPointKey,
      to: targetPointKey,
    })) {
      usedEdgeIds.add(edgeId)
    }
  }

  return connectionEdges
    .filter((edge) => usedEdgeIds.has(edge.edgeId))
    .reduce((total, edge) => total + edge.viaCount, 0)
}

/** Return the first original connection whose routed path exceeds its via limit. */
export const getMaxViaCountViolation = ({
  connections,
  routedConnections,
  traces,
}: {
  connections: readonly SimpleRouteConnection[]
  routedConnections: readonly SimpleRouteConnection[]
  traces: SimplifiedPcbTraces
}): MaxViaCountViolation | null => {
  const constrainedConnectionNames = new Set(
    connections
      .filter((connection) => connection.maxViaCount !== undefined)
      .map((connection) => connection.name),
  )
  const routeGraphEdges = buildRouteGraphEdges({
    constrainedConnectionNames,
    routedConnections,
    traces,
  })

  for (const connection of connections) {
    if (connection.maxViaCount === undefined) continue
    const actualViaCount = getViaCountForOriginalConnection({
      connection,
      routeGraphEdges,
    })
    if (actualViaCount <= connection.maxViaCount) continue

    return {
      connectionName: connection.name,
      actualViaCount,
      maxViaCount: connection.maxViaCount,
    }
  }

  return null
}
