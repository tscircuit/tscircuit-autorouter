import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GraphicsObject } from "graphics-debug"
import {
  ConnectionPoint,
  PointId,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { seededRandom } from "lib/utils/cloneAndShuffleArray"
import { BaseSolver } from "../BaseSolver"
import { buildMinimumSpanningTree } from "./buildMinimumSpanningTree"
import { getInitiallyConnectedStateForConnection } from "./get-initially-connected-state-for-connection"
import { mergeConnections } from "./mergeConnections"

type ConnectionName = SimpleRouteConnection["name"]
type PathHop = {
  fromId: PointId
  toId: PointId
  connectionName: ConnectionName
  index: number
}
type PathEdge = {
  from: ConnectionPoint
  to: ConnectionPoint
  weight: number
  hops: PathHop[]
}

/**
 * Converts a net containing many points to connect into an array of point pair
 * connections.
 *
 * For example, a connection with 3 pointsToConnect could be turned into 2
 * connections of 2 points each.
 *
 * Where we create the minimum number of pairs, we're using a minimum spanning
 * tree (MST). Consecutive IDs of a connection's `path` enter the MST as
 * zero-weight edges, so a written trace path is routed in order and the other
 * points of the net join it by distance.
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
  readonly initiallyConnectedMap: ConnectivityMap
  readonly pathHops: PathHop[]
  /** Emitted names indexed by source path and hop, including un-emitted slots. */
  readonly pathHopConnectionNames = new Map<
    ConnectionName,
    Array<ConnectionName | undefined>
  >()

  constructor(
    public ogSrj: SimpleRouteJson,
    public colorMap: Record<string, string> = {},
    initiallyConnectedMap: ConnectivityMap,
  ) {
    super()
    const busTraceWidthsByConnectionName = new Map<ConnectionName, number>()
    for (const bus of ogSrj.buses ?? []) {
      if (bus.traceWidth === undefined) continue
      for (const connectionName of bus.connectionNames) {
        busTraceWidthsByConnectionName.set(
          connectionName,
          Math.max(
            busTraceWidthsByConnectionName.get(connectionName) ?? 0,
            bus.traceWidth,
          ),
        )
      }
    }
    const connectionsWithBusTraceWidths = ogSrj.connections.map(
      (connection) => {
        const busTraceWidth = busTraceWidthsByConnectionName.get(
          connection.name,
        )
        if (busTraceWidth === undefined) return connection
        return {
          ...connection,
          nominalTraceWidth: Math.max(
            connection.nominalTraceWidth ?? 0,
            busTraceWidth,
          ),
        }
      },
    )
    this.unprocessedConnections = mergeConnections(
      connectionsWithBusTraceWidths,
    )
    this.newConnections = []
    this.initiallyConnectedMap = initiallyConnectedMap
    this.pathHops = ogSrj.connections.flatMap(({ name, path }) => {
      if (!path) return []
      this.pathHopConnectionNames.set(
        name,
        path.slice(1).map(() => undefined),
      )
      return path.slice(1).map((toId, index) => ({
        fromId: path[index]!,
        toId,
        connectionName: name,
        index,
      }))
    })
  }

  /** Zero-weight MST edges for the path pairs whose points are in `connection`. */
  getPathEdges(connection: SimpleRouteConnection): PathEdge[] {
    const pointsById = new Map(
      connection.pointsToConnect.map((point) => [point.pointId, point]),
    )
    const edges: PathEdge[] = []
    for (const hop of this.pathHops) {
      const from = pointsById.get(hop.fromId)
      const to = pointsById.get(hop.toId)
      if (!from || !to) continue
      const sharedEdge = edges.find(
        (edge) =>
          (edge.from === from && edge.to === to) ||
          (edge.from === to && edge.to === from),
      )
      if (sharedEdge) sharedEdge.hops.push(hop)
      else edges.push({ from, to, weight: 0, hops: [hop] })
    }
    return edges
  }

  protected emitConnection(
    connection: SimpleRouteConnection,
    pathEdge?: PathEdge,
  ): void {
    for (const hop of pathEdge?.hops ?? []) {
      this.pathHopConnectionNames.get(hop.connectionName)![hop.index] =
        connection.name
    }
    this.newConnections.push(connection)
  }

  _step() {
    if (this.unprocessedConnections.length === 0) {
      this.solved = true
      return
    }
    const connection = this.unprocessedConnections.pop()!
    const pathEdges = this.getPathEdges(connection)

    const { zeroWeightEdges, arePointsConnected } =
      getInitiallyConnectedStateForConnection(
        connection,
        this.initiallyConnectedMap,
      )

    if (connection.pointsToConnect.length === 2) {
      const [startPoint, endPoint] = connection.pointsToConnect
      if (startPoint && endPoint && arePointsConnected(startPoint, endPoint)) {
        return
      }
      this.emitConnection(
        {
          ...connection,
          __rootConnectionNames: connection.__rootConnectionNames ?? [
            connection.name,
          ],
        },
        pathEdges[0],
      )
      return
    }

    const edges = buildMinimumSpanningTree(connection.pointsToConnect, {
      extraEdges: [...pathEdges, ...zeroWeightEdges],
    })

    let mstIdx = 0
    for (const edge of edges) {
      if (arePointsConnected(edge.from, edge.to)) {
        continue
      }
      this.emitConnection(
        {
          ...connection,
          pointsToConnect: [edge.from, edge.to],
          name: `${connection.name}_mst${mstIdx++}`,
          __rootConnectionNames: connection.__rootConnectionNames ?? [
            connection.name,
          ],
          __netConnectionName: connection.__netConnectionName,
        },
        pathEdges.find((pathEdge) => pathEdge === edge),
      )
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
          label: point.pcb_port_id ?? point.pointId,
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
          label: connection.name,
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
          label: point.pcb_port_id ?? point.pointId,
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
            label: connection.name,
          })
        }
      }
    })

    return graphics
  }
}
