import {
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { BaseSolver } from "../BaseSolver"
import { buildMinimumSpanningTree } from "./buildMinimumSpanningTree"
import { GraphicsObject } from "graphics-debug"
import { mergeConnections } from "./mergeConnections"
import { seededRandom } from "lib/utils/cloneAndShuffleArray"
import { DSU } from "lib/utils/dsu"

const MIN_TRACE_ENDPOINT_MATCH_TOLERANCE = 0.001

export const getExternalConnectionState = (
  connection: SimpleRouteConnection,
  srj?: SimpleRouteJson,
): {
  pointIdToGroup: Map<string, number>
  zeroWeightEdges: Array<{
    from: ConnectionPoint
    to: ConnectionPoint
    weight: number
  }>
} => {
  const externalGroups = connection.externallyConnectedPointIds ?? []
  const routedTraceGroups = getTraceConnectedPointGroups(connection, srj)
  const allExternalGroups = [...externalGroups, ...routedTraceGroups]
  const pointIdToGroup = new Map<string, number>()
  const pointById = new Map<string, ConnectionPoint>()

  for (const point of connection.pointsToConnect) {
    if (point.pointId) {
      pointById.set(point.pointId, point)
    }
  }

  const zeroWeightEdges: Array<{
    from: ConnectionPoint
    to: ConnectionPoint
    weight: number
  }> = []

  const connectionPointIds = [...pointById.keys()]
  const externallyConnectedPointDsu = new DSU(connectionPointIds)
  for (const group of allExternalGroups) {
    const groupPointIds = group.filter((pointId) => pointById.has(pointId))
    const representativePointId = groupPointIds[0]
    if (!representativePointId) continue

    for (let i = 1; i < groupPointIds.length; i++) {
      externallyConnectedPointDsu.union(
        representativePointId,
        groupPointIds[i]!,
      )
    }
  }

  const connectedGroupsByRoot = new Map<string, ConnectionPoint[]>()
  for (const pointId of connectionPointIds) {
    const root = externallyConnectedPointDsu.find(pointId)
    const groupPoints = connectedGroupsByRoot.get(root) ?? []
    groupPoints.push(pointById.get(pointId)!)
    connectedGroupsByRoot.set(root, groupPoints)
  }

  let groupIndex = 0
  for (const groupPoints of connectedGroupsByRoot.values()) {
    if (groupPoints.length < 2) continue

    for (const point of groupPoints) {
      pointIdToGroup.set(point.pointId!, groupIndex)
    }

    const representativePoint = groupPoints[0]
    for (let i = 1; i < groupPoints.length; i++) {
      zeroWeightEdges.push({
        from: representativePoint!,
        to: groupPoints[i]!,
        weight: 0,
      })
    }
    groupIndex++
  }

  return { pointIdToGroup, zeroWeightEdges }
}

const getTraceConnectedPointGroups = (
  connection: SimpleRouteConnection,
  srj: SimpleRouteJson | undefined,
): string[][] => {
  if (!srj?.traces?.length) return []

  const connectionPointIds = new Set(
    connection.pointsToConnect
      .map((point) => point.pointId)
      .filter((pointId): pointId is string => Boolean(pointId)),
  )

  if (connectionPointIds.size === 0) return []

  const routedTraceGroups: string[][] = []
  const rootConnectionNames = new Set([
    connection.name,
    ...(connection.__rootConnectionNames ?? []),
  ])
  for (const trace of srj.traces) {
    const traceConnectsTo = trace.connectsTo ?? []
    if (traceConnectsTo.length > 0) {
      const connectedPointIds = traceConnectsTo.filter((connectsTo) =>
        connectionPointIds.has(connectsTo),
      )
      if (connectedPointIds.length >= 2) {
        routedTraceGroups.push(connectedPointIds)
      }
      continue
    }

    if (!rootConnectionNames.has(trace.connection_name)) continue

    // Some SRJs omit connectsTo on pre-routed traces, so infer the connected
    // point pair from route endpoints when the trace belongs to this net.
    const wireRoutePoints = trace.route.filter(
      (routePoint) => routePoint.route_type === "wire",
    )
    const traceEndpoints = [wireRoutePoints[0], wireRoutePoints.at(-1)]
    const inferredPointIds: string[] = []

    for (const endpoint of traceEndpoints) {
      if (!endpoint) continue
      const tolerance = Math.max(
        MIN_TRACE_ENDPOINT_MATCH_TOLERANCE,
        endpoint.width / 2,
      )
      let bestPoint: ConnectionPoint | undefined
      let bestPointUsesEndpointLayer = false
      let bestDistance = Infinity

      for (const point of connection.pointsToConnect) {
        if (!point.pointId) continue
        const pointUsesEndpointLayer =
          "layers" in point
            ? point.layers.includes(endpoint.layer)
            : point.layer === endpoint.layer
        const pointDistance = Math.hypot(
          point.x - endpoint.x,
          point.y - endpoint.y,
        )
        if (pointDistance > tolerance) continue
        if (
          !bestPoint ||
          (pointUsesEndpointLayer && !bestPointUsesEndpointLayer) ||
          (pointUsesEndpointLayer === bestPointUsesEndpointLayer &&
            pointDistance < bestDistance)
        ) {
          bestPoint = point
          bestPointUsesEndpointLayer = pointUsesEndpointLayer
          bestDistance = pointDistance
        }
      }

      if (bestPoint?.pointId && !inferredPointIds.includes(bestPoint.pointId)) {
        inferredPointIds.push(bestPoint.pointId)
      }
    }

    if (inferredPointIds.length >= 2) {
      routedTraceGroups.push(inferredPointIds)
    }
  }

  return routedTraceGroups
}

export const areExternallyConnected = (
  pointIdToGroup: Map<string, number>,
  a: { pointId?: string },
  b: { pointId?: string },
) => {
  if (!a.pointId || !b.pointId) return false
  const g1 = pointIdToGroup.get(a.pointId)
  const g2 = pointIdToGroup.get(b.pointId)
  return g1 !== undefined && g1 === g2
}

/**
 * Converts a net containing many points to connect into an array of point pair
 * connections.
 *
 * For example, a connection with 3 pointsToConnect could be turned into 2
 * connections of 2 points each.
 *
 * Where we create the minimum number of pairs, we're using a minimum spanning
 * tree (MST).
 *
 * Sometimes it can be used to add additional traces to help make sure we
 * distribute load effectively. In this version we don't do that!
 */
export class NetToPointPairsSolver extends BaseSolver {
  override getSolverName(): string {
    return "NetToPointPairsSolver"
  }

  unprocessedConnections: Array<SimpleRouteConnection>
  newConnections: Array<SimpleRouteConnection>

  constructor(
    public ogSrj: SimpleRouteJson,
    public colorMap: Record<string, string> = {},
  ) {
    super()
    this.unprocessedConnections = mergeConnections([...ogSrj.connections])
    this.newConnections = []
  }

  _step() {
    if (this.unprocessedConnections.length === 0) {
      this.solved = true
      return
    }
    const connection = this.unprocessedConnections.pop()!

    // ----------------------------------------------
    // 1.  Detect externally-connected point groups
    // ----------------------------------------------
    const { pointIdToGroup, zeroWeightEdges } = getExternalConnectionState(
      connection,
      this.ogSrj,
    )

    if (connection.pointsToConnect.length === 2) {
      if (
        areExternallyConnected(
          pointIdToGroup,
          connection.pointsToConnect[0],
          connection.pointsToConnect[1],
        )
      ) {
        // No routing required – they are already connected off-board
        return
      }
      this.newConnections.push({
        ...connection,
        __rootConnectionNames: connection.__rootConnectionNames ?? [
          connection.name,
        ],
      })
      return
    }

    const edges = buildMinimumSpanningTree(connection.pointsToConnect, {
      extraEdges: zeroWeightEdges,
    })

    let mstIdx = 0
    for (const edge of edges) {
      if (areExternallyConnected(pointIdToGroup, edge.from, edge.to)) continue
      this.newConnections.push({
        pointsToConnect: [edge.from, edge.to],
        name: `${connection.name}_mst${mstIdx++}`,
        __rootConnectionNames: connection.__rootConnectionNames ?? [
          connection.name,
        ],
        netConnectionName: connection.netConnectionName,
      })
    }
  }

  getNewSimpleRouteJson(): SimpleRouteJson {
    const detachedSrj = structuredClone(this.ogSrj)
    return {
      ...detachedSrj,
      connections: structuredClone(this.newConnections),
    }
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
      coordinateSystem: "cartesian",
      title: "Net To Point Pairs Visualization",
    }

    // Draw unprocessed connections in red
    this.unprocessedConnections.forEach((connection) => {
      // Draw points
      connection.pointsToConnect.forEach((point) => {
        graphics.points!.push({
          x: point.x,
          y: point.y,
          color: "red",
          label: connection.name,
        })
      })

      // Draw lines connecting all points in the connection
      const fullyConnectedEdgeCount = connection.pointsToConnect.length ** 2
      const random = seededRandom(0)
      const alreadyPlacedEdges = new Set<string>()
      for (
        let i = 0;
        i <
        Math.max(
          fullyConnectedEdgeCount,
          connection.pointsToConnect.length * 2,
        );
        i++
      ) {
        const a = Math.floor(random() * connection.pointsToConnect.length)
        const b = Math.floor(random() * connection.pointsToConnect.length)
        if (alreadyPlacedEdges.has(`${a}-${b}`)) continue
        alreadyPlacedEdges.add(`${a}-${b}`)
        graphics.lines!.push({
          points: [
            connection.pointsToConnect[a],
            connection.pointsToConnect[b],
          ],
          strokeColor: "rgba(255,0,0,0.25)",
        })
      }
    })

    // Draw processed connections with appropriate colors
    this.newConnections.forEach((connection) => {
      const color = this.colorMap?.[connection.name] || "blue"

      // Draw points
      connection.pointsToConnect.forEach((point) => {
        graphics.points!.push({
          x: point.x,
          y: point.y,
          color: color,
          label: connection.name,
        })
      })

      // Draw lines connecting all points in the connection
      for (let i = 0; i < connection.pointsToConnect.length - 1; i++) {
        for (let j = i + 1; j < connection.pointsToConnect.length; j++) {
          graphics.lines!.push({
            points: [
              connection.pointsToConnect[i],
              connection.pointsToConnect[j],
            ],
            strokeColor: color,
          })
        }
      }
    })

    return graphics
  }
}
