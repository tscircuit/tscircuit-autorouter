import {
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import { BaseSolver } from "../BaseSolver"
import { buildMinimumSpanningTree } from "./buildMinimumSpanningTree"
import { GraphicsObject } from "graphics-debug"
import { mergeConnections } from "./mergeConnections"
import { seededRandom } from "lib/utils/cloneAndShuffleArray"

const MIN_TRACE_ENDPOINT_MATCH_TOLERANCE = 0.001
type WireRoutePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "wire" }
>

const getConnectionPointAtTraceEndpoint = (
  endpoint: WireRoutePoint,
  connectionPoints: ConnectionPoint[],
): ConnectionPoint | undefined => {
  const tolerance = Math.max(
    MIN_TRACE_ENDPOINT_MATCH_TOLERANCE,
    endpoint.width / 2,
  )
  let bestPoint: ConnectionPoint | undefined
  let bestPointUsesEndpointLayer = false
  let bestDistance = Infinity

  for (const point of connectionPoints) {
    const pointUsesEndpointLayer =
      "layers" in point
        ? point.layers.includes(endpoint.layer)
        : point.layer === endpoint.layer
    const pointDistance = Math.hypot(point.x - endpoint.x, point.y - endpoint.y)
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

  return bestPoint
}

const getTraceConnectedPointGroups = (
  connection: SimpleRouteConnection,
  srj: SimpleRouteJson | undefined,
): ConnectionPoint[][] => {
  if (!srj?.traces?.length) return []

  const pointById = new Map(
    connection.pointsToConnect.flatMap((point) =>
      point.pointId ? [[point.pointId, point] as const] : [],
    ),
  )
  const routedTraceGroups: ConnectionPoint[][] = []
  const rootConnectionNames = new Set([
    connection.name,
    ...(connection.__rootConnectionNames ?? []),
  ])
  for (const trace of srj.traces) {
    const traceConnectsTo = trace.connectsTo ?? []
    if (traceConnectsTo.length > 0) {
      const connectedPointIds = traceConnectsTo.filter((connectsTo) =>
        pointById.has(connectsTo),
      )
      if (connectedPointIds.length >= 2) {
        routedTraceGroups.push(
          connectedPointIds.map((pointId) => pointById.get(pointId)!),
        )
      }
      continue
    }

    if (!rootConnectionNames.has(trace.connection_name)) continue

    // Some SRJs omit connectsTo on pre-routed traces, so infer the connected
    // point pair from route endpoints when the trace belongs to this net.
    const wireRoutePoints = trace.route.filter(
      (routePoint) => routePoint.route_type === "wire",
    )
    const startPoint = wireRoutePoints[0]
      ? getConnectionPointAtTraceEndpoint(
          wireRoutePoints[0],
          connection.pointsToConnect,
        )
      : undefined
    const endPoint = wireRoutePoints.at(-1)
      ? getConnectionPointAtTraceEndpoint(
          wireRoutePoints.at(-1)!,
          connection.pointsToConnect,
        )
      : undefined

    if (startPoint && endPoint && startPoint !== endPoint) {
      routedTraceGroups.push([startPoint, endPoint])
    }
  }

  return routedTraceGroups
}

export const getPreconnectedPointGroups = (
  connection: SimpleRouteConnection,
  srj?: SimpleRouteJson,
): ConnectionPoint[][] => {
  const pointById = new Map(
    connection.pointsToConnect.flatMap((point) =>
      point.pointId ? [[point.pointId, point] as const] : [],
    ),
  )
  const externalGroups = (connection.externallyConnectedPointIds ?? [])
    .map((group) =>
      group.flatMap((pointId) => {
        const point = pointById.get(pointId)
        return point ? [point] : []
      }),
    )
    .filter((group) => group.length >= 2)

  return [...externalGroups, ...getTraceConnectedPointGroups(connection, srj)]
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
    const preconnectedPointGroups = getPreconnectedPointGroups(
      connection,
      this.ogSrj,
    )

    if (connection.pointsToConnect.length === 2) {
      const [startPoint, endPoint] = connection.pointsToConnect
      if (
        preconnectedPointGroups.some(
          (group) => group.includes(startPoint) && group.includes(endPoint),
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
      preconnectedGroups: preconnectedPointGroups,
    })

    let mstIdx = 0
    for (const edge of edges) {
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
