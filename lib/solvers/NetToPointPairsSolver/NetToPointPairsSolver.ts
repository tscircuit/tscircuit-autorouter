import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { distance } from "@tscircuit/math-utils"
import { GraphicsObject } from "graphics-debug"
import {
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { getPointKey } from "lib/utils/getPointKey"
import { seededRandom } from "lib/utils/cloneAndShuffleArray"
import { BaseSolver } from "../BaseSolver"
import { buildMinimumSpanningTree } from "./buildMinimumSpanningTree"
import { getInitiallyConnectedStateForConnection } from "./get-initially-connected-state-for-connection"
import { mergeConnections } from "./mergeConnections"
import { getConnectionPathPoints } from "./getConnectionPathPoints"

type ConnectionName = SimpleRouteConnection["name"]

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
  readonly initiallyConnectedMap: ConnectivityMap
  protected readonly pathEdgesByConnection: Map<
    SimpleRouteConnection,
    ReturnType<typeof buildMinimumSpanningTree<ConnectionPoint>>
  > = new Map()

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
    if (!connectionsWithBusTraceWidths.some((connection) => connection.path))
      return
    const mergedByPoint = new Map(
      this.unprocessedConnections.flatMap((connection) =>
        connection.pointsToConnect.map((point) => [
          getPointKey(point),
          connection,
        ]),
      ),
    )
    for (const connection of connectionsWithBusTraceWidths) {
      if (!connection.path) continue
      const points = getConnectionPathPoints(connection)
      const merged = mergedByPoint.get(getPointKey(points[0]!))!
      const edges = this.pathEdgesByConnection.get(merged) ?? []
      for (let index = 1; index < points.length; index++) {
        const from = points[index - 1]!
        const to = points[index]!
        if (
          edges.some(
            (edge) =>
              (getPointKey(edge.from) === getPointKey(from) &&
                getPointKey(edge.to) === getPointKey(to)) ||
              (getPointKey(edge.from) === getPointKey(to) &&
                getPointKey(edge.to) === getPointKey(from)),
          )
        )
          continue
        edges.push({ from, to, weight: distance(from, to) })
      }
      this.pathEdgesByConnection.set(merged, edges)
    }
  }

  _step() {
    if (this.unprocessedConnections.length === 0) {
      this.solved = true
      return
    }
    const mergedConnection = this.unprocessedConnections.pop()!
    const requiredEdges = this.pathEdgesByConnection.get(mergedConnection) ?? []
    const { path, ...connection } = mergedConnection

    const { zeroWeightEdges, arePointsConnected } =
      getInitiallyConnectedStateForConnection(
        connection,
        this.initiallyConnectedMap,
      )

    if (connection.pointsToConnect.length === 2) {
      const [startPoint, endPoint] = requiredEdges.length
        ? [requiredEdges[0]!.from, requiredEdges[0]!.to]
        : connection.pointsToConnect
      if (startPoint && endPoint && arePointsConnected(startPoint, endPoint)) {
        return
      }
      this.newConnections.push({
        ...connection,
        pointsToConnect: [startPoint!, endPoint!],
        __rootConnectionNames: connection.__rootConnectionNames ?? [
          connection.name,
        ],
      })
      return
    }

    const edges = buildMinimumSpanningTree(connection.pointsToConnect, {
      extraEdges: zeroWeightEdges,
      requiredEdges,
    })

    let mstIdx = 0
    for (const edge of edges) {
      if (arePointsConnected(edge.from, edge.to)) {
        continue
      }
      this.newConnections.push({
        ...connection,
        pointsToConnect: [edge.from, edge.to],
        name: `${connection.name}_mst${mstIdx++}`,
        __rootConnectionNames: connection.__rootConnectionNames ?? [
          connection.name,
        ],
        __netConnectionName: connection.__netConnectionName,
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
