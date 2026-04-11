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

export const getExternalConnectionState = (
  connection: SimpleRouteConnection,
): {
  pointIdToGroup: Map<string, number>
  zeroWeightEdges: Array<{
    from: ConnectionPoint
    to: ConnectionPoint
    weight: number
  }>
} => {
  const externalGroups = connection.externallyConnectedPointIds ?? []
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

  externalGroups.forEach((group, idx) => {
    const groupPoints = group
      .map((pointId) => pointById.get(pointId))
      .filter((point): point is ConnectionPoint => Boolean(point))

    for (const point of groupPoints) {
      if (point.pointId) {
        pointIdToGroup.set(point.pointId, idx)
      }
    }

    const representativePoint = groupPoints[0]
    if (!representativePoint) {
      return
    }

    for (let i = 1; i < groupPoints.length; i++) {
      zeroWeightEdges.push({
        from: representativePoint,
        to: groupPoints[i]!,
        weight: 0,
      })
    }
  })

  return { pointIdToGroup, zeroWeightEdges }
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
    const { pointIdToGroup, zeroWeightEdges } =
      getExternalConnectionState(connection)

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
        rootConnectionName: connection.name,
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
        rootConnectionName: connection.name,
        mergedConnectionNames: connection.mergedConnectionNames,
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
