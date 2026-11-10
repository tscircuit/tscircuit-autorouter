import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GraphicsObject } from "graphics-debug"
import type { ConnectionPoint, SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { seededRandom } from "lib/utils/cloneAndShuffleArray"
import { BaseSolver } from "../BaseSolver"
import { buildMinimumSpanningTree } from "./buildMinimumSpanningTree"
import { getInitiallyConnectedStateForConnection } from "./get-initially-connected-state-for-connection"
import { mergeConnections } from "./mergeConnections"
import {
  type DifferentialPairInput,
  planDifferentialPairSections,
} from "./planDifferentialPairSections"

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
  private readonly differentialPairSectionPlan: ReturnType<
    typeof planDifferentialPairSections
  >
  readonly differentialPairSectionNamesByMember: ReadonlyMap<
    ConnectionName,
    ConnectionName[]
  >

  constructor(
    public ogSrj: SimpleRouteJson,
    public colorMap: Record<string, string> = {},
    initiallyConnectedMap: ConnectivityMap,
    differentialPairInput?: DifferentialPairInput,
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
    this.differentialPairSectionPlan = planDifferentialPairSections(
      differentialPairInput,
      connectionsWithBusTraceWidths,
      this.unprocessedConnections,
    )
    this.differentialPairSectionNamesByMember =
      this.differentialPairSectionPlan.sectionNamesByMember
    this.newConnections = []
    this.initiallyConnectedMap = initiallyConnectedMap
  }

  protected routeOrderedSectionsAndGetRemainingEdges(
    connection: SimpleRouteConnection,
    connectedState: ReturnType<typeof getInitiallyConnectedStateForConnection>,
  ): ReturnType<typeof buildMinimumSpanningTree<ConnectionPoint>> {
    const sections = this.differentialPairSectionPlan.sectionsByMergedConnection.get(
      connection.name,
    )
    if (!sections) {
      return buildMinimumSpanningTree(connection.pointsToConnect, {
        extraEdges: connectedState.zeroWeightEdges,
      })
    }

    const orderedEdges = sections.map((section) => {
      const [from, to] = section.pointsToConnect
      if (connectedState.arePointsConnected(from!, to!)) {
        throw new Error(
          `Differential pair section "${section.name}" already has copper and cannot be routed as a new paired section`,
        )
      }
      return { from: from!, to: to!, weight: 0 }
    })
    this.newConnections.push(...sections)

    // Treat the ordered sections as connected when picking links to any taps.
    const orderedEdgeSet = new Set(orderedEdges)
    return buildMinimumSpanningTree(connection.pointsToConnect, {
      extraEdges: [...orderedEdges, ...connectedState.zeroWeightEdges],
    }).filter((edge) => !orderedEdgeSet.has(edge))
  }

  _step() {
    if (this.unprocessedConnections.length === 0) {
      this.solved = true
      return
    }
    const connection = this.unprocessedConnections.pop()!

    const connectedState = getInitiallyConnectedStateForConnection(
      connection,
      this.initiallyConnectedMap,
    )
    const { arePointsConnected } = connectedState

    if (connection.pointsToConnect.length === 2) {
      const [startPoint, endPoint] = connection.pointsToConnect
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

    const edges = this.routeOrderedSectionsAndGetRemainingEdges(
      connection,
      connectedState,
    )

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
