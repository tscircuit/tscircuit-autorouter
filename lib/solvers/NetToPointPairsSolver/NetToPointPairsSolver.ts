import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GraphicsObject } from "graphics-debug"
import {
  ConnectionPoint,
  PointId,
  SimpleRouteConnection,
  SimpleRouteJson,
  getConnectionPointLayers,
} from "lib/types"
import { seededRandom } from "lib/utils/cloneAndShuffleArray"
import { BaseSolver } from "../BaseSolver"
import { buildMinimumSpanningTree } from "./buildMinimumSpanningTree"
import { getInitiallyConnectedStateForConnection } from "./get-initially-connected-state-for-connection"
import { mergeConnections } from "./mergeConnections"
import { orderMstEdgesForStablePairNames } from "./orderMstEdgesForStablePairNames"

type ConnectionName = SimpleRouteConnection["name"]
interface PathHop {
  fromPointId: PointId
  toPointId: PointId
  nominalTraceWidth?: number
  /** Name of the point-pair connection emitted for this hop. */
  emittedConnectionName?: ConnectionName
}
type PathEdge = {
  from: ConnectionPoint
  to: ConnectionPoint
  weight: number
  hops: PathHop[]
}

function isSamePadLocation(a: ConnectionPoint, b: ConnectionPoint): boolean {
  if (a === b) return true
  if (a.x !== b.x || a.y !== b.y) return false
  const layersA = getConnectionPointLayers(a)
  const layersB = getConnectionPointLayers(b)
  return (
    layersA.length === layersB.length &&
    layersA.every((layer) => layersB.includes(layer))
  )
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
 * points of the net join it by distance. An explicitly sized hop is kept with
 * its own width even when it closes a loop.
 */
export class NetToPointPairsSolver extends BaseSolver {
  override getSolverName(): string {
    return "NetToPointPairsSolver"
  }

  unprocessedConnections: Array<SimpleRouteConnection>
  newConnections: Array<SimpleRouteConnection>
  readonly initiallyConnectedMap: ConnectivityMap
  /** Each connection's `path` as hops, in written order. */
  readonly pathHopsByConnectionName = new Map<ConnectionName, PathHop[]>()

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
    const connectionsForMst = ogSrj.connections.map((connection) => {
      const { name, path } = connection
      const busWidth = busTraceWidthsByConnectionName.get(name)
      const traceWidth = connection.nominalTraceWidth ?? connection.width
      const nominalTraceWidth =
        busWidth === undefined
          ? traceWidth
          : Math.max(busWidth, traceWidth ?? 0)
      if (!path || path.length < 2) {
        if (nominalTraceWidth === connection.nominalTraceWidth)
          return connection
        return { ...connection, nominalTraceWidth }
      }
      const hops: PathHop[] = []
      for (let i = 1; i < path.length; i++) {
        hops.push({
          fromPointId: path[i - 1]!,
          toPointId: path[i]!,
          nominalTraceWidth,
        })
      }
      this.pathHopsByConnectionName.set(name, hops)
      // The path owns its width. Only the other connections set the net width.
      return { ...connection, nominalTraceWidth: undefined, width: undefined }
    })
    this.unprocessedConnections = mergeConnections(connectionsForMst)
    this.newConnections = []
    this.initiallyConnectedMap = initiallyConnectedMap
  }

  /** Zero-weight MST edges for the path pairs whose points are in `connection`. */
  getPathEdges(connection: SimpleRouteConnection): PathEdge[] {
    const pointsById = new Map(
      connection.pointsToConnect.map((point) => [point.pointId, point]),
    )
    const edges: PathEdge[] = []
    for (const hops of this.pathHopsByConnectionName.values()) {
      for (const hop of hops) {
        const from = pointsById.get(hop.fromPointId)
        const to = pointsById.get(hop.toPointId)
        if (!from || !to) continue
        const sharedEdge = edges.find(
          (edge) =>
            (isSamePadLocation(edge.from, from) &&
              isSamePadLocation(edge.to, to)) ||
            (isSamePadLocation(edge.from, to) &&
              isSamePadLocation(edge.to, from)),
        )
        if (sharedEdge) sharedEdge.hops.push(hop)
        else edges.push({ from, to, weight: 0, hops: [hop] })
      }
    }
    return edges
  }

  protected emitConnection(
    connection: SimpleRouteConnection,
    pathEdge?: PathEdge,
  ): void {
    let pathWidth: number | undefined
    for (const hop of pathEdge?.hops ?? []) {
      hop.emittedConnectionName = connection.name
      if (hop.nominalTraceWidth !== undefined) {
        pathWidth = Math.max(pathWidth ?? 0, hop.nominalTraceWidth)
      }
    }
    if (pathWidth !== undefined) {
      connection.nominalTraceWidth = pathWidth
      connection.width = pathWidth
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
    const fixedWidthEdges = pathEdges.filter((edge) =>
      edge.hops.some((hop) => hop.nominalTraceWidth !== undefined),
    )
    if (fixedWidthEdges.length && connection.nominalTraceWidth === undefined) {
      connection.nominalTraceWidth =
        connection.width ??
        this.ogSrj.nominalTraceWidth ??
        this.ogSrj.minTraceWidth
    }

    const { zeroWeightEdges, arePointsConnected } =
      getInitiallyConnectedStateForConnection(
        connection,
        this.initiallyConnectedMap,
      )

    if (connection.pointsToConnect.length === 2) {
      const [startPoint, endPoint] = connection.pointsToConnect
      if (
        startPoint &&
        endPoint &&
        (arePointsConnected(startPoint, endPoint) ||
          (fixedWidthEdges.length && isSamePadLocation(startPoint, endPoint)))
      ) {
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

    // Break nearly equal XY choices without buying fewer vias with long detours.
    const layerChangeCost = this.ogSrj.minTraceWidth * 0.05
    const originalEdges = buildMinimumSpanningTree(connection.pointsToConnect, {
      extraEdges: [...pathEdges, ...zeroWeightEdges],
    })
    const optimizedEdges = buildMinimumSpanningTree(
      connection.pointsToConnect,
      {
        extraEdges: [...pathEdges, ...zeroWeightEdges],
        getAdditionalEdgeCost: (from, to): number =>
          getConnectionPointLayers(from).some((layer) =>
            getConnectionPointLayers(to).includes(layer),
          )
            ? 0
            : layerChangeCost,
      },
    )
    const edges = orderMstEdgesForStablePairNames({
      points: connection.pointsToConnect,
      originalEdges,
      optimizedEdges,
    })
    // Kruskal drops the last edge of a cycle. A requested width still needs
    // that physical pair even when the other requested pairs already span it.
    for (const pathEdge of fixedWidthEdges) {
      if (
        !edges.includes(pathEdge) &&
        !isSamePadLocation(pathEdge.from, pathEdge.to)
      ) {
        edges.push(pathEdge)
      }
    }

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
