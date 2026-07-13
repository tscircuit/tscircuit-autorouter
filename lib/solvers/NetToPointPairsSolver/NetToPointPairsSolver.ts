import { GraphicsObject } from "graphics-debug"
import {
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { seededRandom } from "lib/utils/cloneAndShuffleArray"
import { BaseSolver } from "../BaseSolver"
import { type Edge, buildMinimumSpanningTree } from "./buildMinimumSpanningTree"
import { mergeConnections } from "./mergeConnections"

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

  allExternalGroups.forEach((group, idx) => {
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
  for (const trace of srj.traces) {
    const traceConnectsTo = trace.connectsTo ?? []
    if (traceConnectsTo.length < 2) continue

    const connectedPointIds = traceConnectsTo.filter((connectsTo) =>
      connectionPointIds.has(connectsTo),
    )
    if (connectedPointIds.length >= 2) {
      routedTraceGroups.push(connectedPointIds)
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
  componentPadPoints = new Map<string, ConnectionPoint[]>()

  constructor(
    public ogSrj: SimpleRouteJson,
    public colorMap: Record<string, string> = {},
    public opts: {
      avoidNonAdjacentSameComponentPadPairs?: boolean
    } = {},
  ) {
    super()
    for (const connection of ogSrj.connections) {
      for (const point of connection.pointsToConnect) {
        const componentPad = this.getComponentPad(point)
        if (!componentPad) continue
        const componentPoints =
          this.componentPadPoints.get(componentPad.componentId) ?? []
        if (!componentPoints.some(({ pointId }) => pointId === point.pointId)) {
          componentPoints.push(point)
          this.componentPadPoints.set(componentPad.componentId, componentPoints)
        }
      }
    }
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

    let edges = buildMinimumSpanningTree(connection.pointsToConnect, {
      extraEdges: zeroWeightEdges,
    })
    if (this.opts.avoidNonAdjacentSameComponentPadPairs) {
      edges = this.replaceNonAdjacentSameComponentPadSpans({
        points: connection.pointsToConnect,
        edges,
        pointIdToGroup,
      })
    }

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

  private replaceNonAdjacentSameComponentPadSpans({
    points,
    edges,
    pointIdToGroup,
  }: {
    points: ConnectionPoint[]
    edges: Edge<ConnectionPoint>[]
    pointIdToGroup: Map<string, number>
  }): Edge<ConnectionPoint>[] {
    const repairedEdges = [...edges]

    for (let edgeIndex = 0; edgeIndex < repairedEdges.length; edgeIndex++) {
      const edge = repairedEdges[edgeIndex]
      if (!this.isNonAdjacentSameComponentPadSpan(edge.from, edge.to)) {
        continue
      }

      const adjacency = new Map<ConnectionPoint, ConnectionPoint[]>()
      for (let i = 0; i < repairedEdges.length; i++) {
        if (i === edgeIndex) continue
        const candidate = repairedEdges[i]
        adjacency.set(candidate.from, [
          ...(adjacency.get(candidate.from) ?? []),
          candidate.to,
        ])
        adjacency.set(candidate.to, [
          ...(adjacency.get(candidate.to) ?? []),
          candidate.from,
        ])
      }

      const reachable = new Set<ConnectionPoint>([edge.from])
      const queue = [edge.from]
      while (queue.length > 0) {
        const current = queue.shift()!
        for (const next of adjacency.get(current) ?? []) {
          if (reachable.has(next)) continue
          reachable.add(next)
          queue.push(next)
        }
      }

      let replacement: Edge<ConnectionPoint> | null = null
      for (const from of points) {
        if (!reachable.has(from)) continue
        for (const to of points) {
          if (reachable.has(to)) continue
          if (this.isNonAdjacentSameComponentPadSpan(from, to)) continue
          const weight = areExternallyConnected(pointIdToGroup, from, to)
            ? 0
            : Math.hypot(from.x - to.x, from.y - to.y)
          if (!replacement || weight < replacement.weight) {
            replacement = { from, to, weight }
          }
        }
      }

      if (replacement) repairedEdges[edgeIndex] = replacement
    }

    return repairedEdges
  }

  private isNonAdjacentSameComponentPadSpan(
    from: ConnectionPoint,
    to: ConnectionPoint,
  ): boolean {
    const fromPad = this.getComponentPad(from)
    const toPad = this.getComponentPad(to)
    if (!fromPad || !toPad) return false
    if (fromPad.componentId !== toPad.componentId) return false

    const dx = to.x - from.x
    const dy = to.y - from.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared === 0) return false

    const interveningPadCount = (
      this.componentPadPoints.get(fromPad.componentId) ?? []
    ).filter((candidate) => {
      if (
        candidate.pointId === from.pointId ||
        candidate.pointId === to.pointId
      ) {
        return false
      }
      const projection =
        ((candidate.x - from.x) * dx + (candidate.y - from.y) * dy) /
        lengthSquared
      if (projection <= 0 || projection >= 1) return false

      const closestX = from.x + projection * dx
      const closestY = from.y + projection * dy
      return Math.hypot(candidate.x - closestX, candidate.y - closestY) < 1e-6
    }).length

    // A single intervening pad can be escaped around the end of the component.
    // Spanning several pads fences off their escapes and creates an inherently
    // interleaved single-layer topology.
    return interveningPadCount >= 2
  }

  private getComponentPad(point: ConnectionPoint) {
    const match = point.pointId?.match(/^(.*)_pad_(\d+)$/)
    if (!match) return null
    return { componentId: match[1], padNumber: Number(match[2]) }
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
