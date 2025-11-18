import { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { BaseSolver } from "../BaseSolver"
import { buildMinimumSpanningTree } from "./buildMinimumSpanningTree"
import { GraphicsObject } from "graphics-debug"
import { seededRandom } from "lib/utils/cloneAndShuffleArray"

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
  unprocessedConnections: Array<SimpleRouteConnection>
  newConnections: Array<SimpleRouteConnection>

  constructor(
    public ogSrj: SimpleRouteJson,
    public colorMap: Record<string, string> = {},
  ) {
    super()
    this.unprocessedConnections = [...ogSrj.connections]
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
    const externalComponentGroups =
      connection.alreadyConnectedToExternalComponent ?? []
    const pointIdToExternalComponentGroup = new Map<string, number>()
    externalComponentGroups.forEach((group, idx) =>
      group.forEach((pid) => pointIdToExternalComponentGroup.set(pid, idx)),
    )

    // ----------------------------------------------
    // 2.  Detect chip-connected point groups
    // ----------------------------------------------
    const internalChipConnectionGroups =
      connection.internallyConnectedInsideTheChip ?? []
    const pointIdToInternalChipConnectionGroup = new Map<string, number>()
    internalChipConnectionGroups.forEach((group, idx) =>
      group.forEach((pid) =>
        pointIdToInternalChipConnectionGroup.set(pid, idx),
      ),
    )

    const areAlreadyConnectedToExternalComponent = (
      a: { pointId?: string },
      b: { pointId?: string },
    ) => {
      if (!a.pointId || !b.pointId) return false
      const g1 = pointIdToExternalComponentGroup.get(a.pointId)
      const g2 = pointIdToExternalComponentGroup.get(b.pointId)
      return g1 !== undefined && g1 === g2
    }

    const areInternallyConnectedInsideTheChip = (
      a: { pointId?: string },
      b: { pointId?: string },
    ) => {
      if (!a.pointId || !b.pointId) return false
      const g1 = pointIdToInternalChipConnectionGroup.get(a.pointId)
      const g2 = pointIdToInternalChipConnectionGroup.get(b.pointId)
      return g1 !== undefined && g1 === g2
    }

    if (connection.pointsToConnect.length === 2) {
      if (
        areAlreadyConnectedToExternalComponent(
          connection.pointsToConnect[0],
          connection.pointsToConnect[1],
        ) ||
        areInternallyConnectedInsideTheChip(
          connection.pointsToConnect[0],
          connection.pointsToConnect[1],
        )
      ) {
        // No routing required – they are already connected
        return
      }
      this.newConnections.push(connection)
      return
    }

    /**
     * For groups of points that are internally connected inside the chip
     * (defined by `internallyConnectedInsideTheChip`), we create a single
     * "representative" point. This is an optimization: instead of routing
     * to every point in the internal group, the autorouter only needs to
     * connect to this one representative point. The internal connections
     * within the chip are assumed to handle the connectivity for the rest
     * of the group.
     *
     * This reduces the complexity of the Minimum Spanning Tree (MST) calculation
     * and results in cleaner, more efficient PCB layouts by avoiding redundant
     * traces to already-connected chip pins.
     */
    const representativePointsForInternallyConnectedChipGroups = new Map<
      number,
      (typeof connection.pointsToConnect)[0]
    >()

    // Find representatives for internal groups (first point in each group)
    connection.pointsToConnect.forEach((point) => {
      if (!point.pointId) return
      const groupId = pointIdToInternalChipConnectionGroup.get(point.pointId)
      if (
        groupId !== undefined &&
        !representativePointsForInternallyConnectedChipGroups.has(groupId)
      ) {
        representativePointsForInternallyConnectedChipGroups.set(groupId, point)
      }
    })

    // Get external points (not in any internal group)
    const externalPoints = connection.pointsToConnect.filter((point) => {
      if (!point.pointId) return true
      return !pointIdToInternalChipConnectionGroup.has(point.pointId)
    })

    // Combine external points with internal representatives
    const pointsForMst = [
      ...externalPoints,
      ...representativePointsForInternallyConnectedChipGroups.values(),
    ]

    // If we have 2 or more points to connect, build MST
    if (pointsForMst.length >= 2) {
      const edges = buildMinimumSpanningTree(pointsForMst)

      let mstIdx = 0
      for (const edge of edges) {
        if (areAlreadyConnectedToExternalComponent(edge.from, edge.to)) continue
        this.newConnections.push({
          pointsToConnect: [edge.from, edge.to],
          name: `${connection.name}_mst${mstIdx++}`,
        })
      }
    }
  }

  getNewSimpleRouteJson(): SimpleRouteJson {
    return {
      ...this.ogSrj,
      connections: this.newConnections,
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
