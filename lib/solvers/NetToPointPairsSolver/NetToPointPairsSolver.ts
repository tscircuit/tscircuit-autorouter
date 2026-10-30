import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GraphicsObject } from "graphics-debug"
import { SimpleRouteConnection, SimpleRouteJson, ConnectionPoint, PointKey } from "lib/types"
import { seededRandom } from "lib/utils/cloneAndShuffleArray"
import { BaseSolver } from "../BaseSolver"
import { buildMinimumSpanningTree } from "./buildMinimumSpanningTree"
import { getInitiallyConnectedStateForConnection } from "./get-initially-connected-state-for-connection"
import { mergeConnections } from "./mergeConnections"

type ConnectionName = SimpleRouteConnection["name"]
export type NetToPointPairsSolverOptions = { pointKey?: (point: ConnectionPoint) => PointKey }
export type LayerAwareMstStats = {
  completed: boolean
  connectionsProcessed: number
  inputPointOccurrences: number
  inputDistinctLayerKeys: number
  mstCoveredLayerKeys: number
  missingLayerKeys: number
  coincidentCrossLayerGroups: number
  zeroDistanceLayerEdges: number
  mstSelectedEdges: number
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
  readonly initiallyConnectedMap: ConnectivityMap
  declare protected mstPointKey?: (point: ConnectionPoint) => PointKey
  declare protected layerAwareDeferredConnections?: SimpleRouteConnection[]
  declare readonly layerAwareMstStats?: LayerAwareMstStats

  constructor(
    public ogSrj: SimpleRouteJson,
    public colorMap: Record<string, string> = {},
    initiallyConnectedMap: ConnectivityMap,
    options?: NetToPointPairsSolverOptions,
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
    if (options?.pointKey !== undefined) {
      this.mstPointKey = options.pointKey
      this.layerAwareDeferredConnections = []
      this.layerAwareMstStats = { completed: false, connectionsProcessed: 0, inputPointOccurrences: 0, inputDistinctLayerKeys: 0, mstCoveredLayerKeys: 0, missingLayerKeys: 0, coincidentCrossLayerGroups: 0, zeroDistanceLayerEdges: 0, mstSelectedEdges: 0 }
    }
  }

  protected recordLayerAwareMstCoverage(connection: SimpleRouteConnection, edges: { from: ConnectionPoint; to: ConnectionPoint }[]): void {
    const key = this.mstPointKey
    const stats = this.layerAwareMstStats
    if (!key || !stats) return
    const required = new Set(connection.pointsToConnect.map(key))
    const covered = new Set(edges.flatMap((edge) => [key(edge.from), key(edge.to)]))
    if (required.size === 1) for (const value of required) covered.add(value)
    const locations = new Map<string, Set<string>>()
    for (const point of connection.pointsToConnect) {
      const xy = JSON.stringify([point.x, point.y])
      const values = locations.get(xy) ?? new Set<string>()
      values.add(key(point)); locations.set(xy, values)
    }
    stats.connectionsProcessed++
    stats.inputPointOccurrences += connection.pointsToConnect.length
    stats.inputDistinctLayerKeys += required.size
    stats.mstCoveredLayerKeys += [...required].filter((value) => covered.has(value)).length
    stats.missingLayerKeys += [...required].filter((value) => !covered.has(value)).length
    stats.coincidentCrossLayerGroups += [...locations.values()].filter((values) => values.size > 1).length
    stats.zeroDistanceLayerEdges += edges.filter((edge) => edge.from.x === edge.to.x && edge.from.y === edge.to.y && key(edge.from) !== key(edge.to)).length
    stats.mstSelectedEdges += edges.length
  }

  protected orderMstEdgesForEmission<T extends { from: ConnectionPoint; to: ConnectionPoint }>(edges: T[]): T[] {
    if (!this.mstPointKey) return edges
    const legacyEdges: T[] = []
    const addedLayerEdges: T[] = []
    for (const edge of edges) {
      const target = edge.from.x === edge.to.x && edge.from.y === edge.to.y ? addedLayerEdges : legacyEdges
      target.push(edge)
    }
    return [...legacyEdges, ...addedLayerEdges]
  }

  protected appendMstConnection(connection: SimpleRouteConnection, edge: { from: ConnectionPoint; to: ConnectionPoint }): void {
    if (this.layerAwareDeferredConnections !== undefined && edge.from.x === edge.to.x && edge.from.y === edge.to.y) {
      // New layer bridges must not rename or reorder existing routing demands.
      this.layerAwareDeferredConnections.push(connection)
    } else {
      this.newConnections.push(connection)
    }
  }

  protected finishPointPairQueue(): void {
    if (this.layerAwareDeferredConnections !== undefined) {
      this.newConnections.push(...this.layerAwareDeferredConnections)
      this.layerAwareDeferredConnections.length = 0
    }
    if (this.layerAwareMstStats) this.layerAwareMstStats.completed = true
    this.solved = true
  }

  _step() {
    if (this.unprocessedConnections.length === 0) {
      this.finishPointPairQueue()
      return
    }
    const connection = this.unprocessedConnections.pop()!

    const { zeroWeightEdges, arePointsConnected } =
      getInitiallyConnectedStateForConnection(
        connection,
        this.initiallyConnectedMap,
      )

    if (connection.pointsToConnect.length === 2) {
      const [startPoint, endPoint] = connection.pointsToConnect
      this.recordLayerAwareMstCoverage(connection, startPoint && endPoint ? [{ from: startPoint, to: endPoint }] : [])
      if (startPoint && endPoint && arePointsConnected(startPoint, endPoint)) {
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
      pointKey: this.mstPointKey,
    })

    this.recordLayerAwareMstCoverage(connection, edges)
    let mstIdx = 0
    for (const edge of this.orderMstEdgesForEmission(edges)) {
      if (arePointsConnected(edge.from, edge.to)) {
        continue
      }
      this.appendMstConnection({
        ...connection,
        pointsToConnect: [edge.from, edge.to],
        name: `${connection.name}_mst${mstIdx++}`,
        __rootConnectionNames: connection.__rootConnectionNames ?? [
          connection.name,
        ],
        __netConnectionName: connection.__netConnectionName,
      }, edge)
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
