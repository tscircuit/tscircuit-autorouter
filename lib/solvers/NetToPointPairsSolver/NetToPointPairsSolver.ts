import {
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { getPointKey } from "lib/utils/getPointKey"
import { DSU } from "lib/utils/dsu"
import { BaseSolver } from "../BaseSolver"
import { buildMinimumSpanningTree } from "./buildMinimumSpanningTree"
import { GraphicsObject } from "graphics-debug"
import { mergeConnections } from "./mergeConnections"
import { seededRandom } from "lib/utils/cloneAndShuffleArray"

export type WeightedConnectionPointEdge = {
  from: ConnectionPoint
  to: ConnectionPoint
  weight: number
}

export type OriginalTwoPointConnectionEdge = WeightedConnectionPointEdge & {
  name: string
  netConnectionName?: string
  nominalTraceWidth?: number
  required: boolean
}

type ExternalConnectionState = {
  pointIdToGroup: Map<string, number>
  zeroWeightEdges: WeightedConnectionPointEdge[]
  originalTwoPointEdges: OriginalTwoPointConnectionEdge[]
}

const isSourceTraceConnection = (
  connection: SimpleRouteConnection,
): boolean => {
  const sourceTraceId = (connection as { source_trace_id?: unknown })
    .source_trace_id
  if (typeof sourceTraceId === "string") return true
  if (connection.name.startsWith("source_trace_")) return true
  return false
}

const buildExternalConnectionGroups = (
  allExternalGroups: string[][],
  pointById: Map<string, ConnectionPoint>,
): {
  pointIdToGroup: Map<string, number>
  zeroWeightEdges: WeightedConnectionPointEdge[]
} => {
  const pointIds = [
    ...new Set(
      allExternalGroups.flat().filter((pointId) => pointById.has(pointId)),
    ),
  ]
  const dsu = new DSU(pointIds)
  const zeroWeightEdges: WeightedConnectionPointEdge[] = []

  for (const group of allExternalGroups) {
    const groupPointIds = group.filter((pointId) => pointById.has(pointId))
    const representativePointId = groupPointIds[0]
    if (!representativePointId) continue

    for (let i = 1; i < groupPointIds.length; i++) {
      const pointId = groupPointIds[i]!
      dsu.union(representativePointId, pointId)
      zeroWeightEdges.push({
        from: pointById.get(representativePointId)!,
        to: pointById.get(pointId)!,
        weight: 0,
      })
    }
  }

  const groupIndexByRoot = new Map<string, number>()
  const pointIdToGroup = new Map<string, number>()
  for (const pointId of pointIds) {
    const root = dsu.find(pointId)
    if (!groupIndexByRoot.has(root)) {
      groupIndexByRoot.set(root, groupIndexByRoot.size)
    }
    pointIdToGroup.set(pointId, groupIndexByRoot.get(root)!)
  }

  return { pointIdToGroup, zeroWeightEdges }
}

const getOriginalTwoPointEdges = (
  connection: SimpleRouteConnection,
  srj: SimpleRouteJson | undefined,
  pointByKey: Map<string, ConnectionPoint>,
): OriginalTwoPointConnectionEdge[] => {
  const mergedConnectionNames = new Set(connection.mergedConnectionNames ?? [])
  if (!srj || mergedConnectionNames.size === 0) {
    return []
  }

  const edges: OriginalTwoPointConnectionEdge[] = []
  for (const originalConnection of srj.connections) {
    if (!mergedConnectionNames.has(originalConnection.name)) continue
    if (originalConnection.pointsToConnect.length !== 2) continue

    const from = pointByKey.get(
      getPointKey(originalConnection.pointsToConnect[0]!),
    )
    const to = pointByKey.get(
      getPointKey(originalConnection.pointsToConnect[1]!),
    )
    if (!from || !to || getPointKey(from) === getPointKey(to)) continue

    edges.push({
      from,
      to,
      weight: 0,
      name: originalConnection.name,
      netConnectionName: originalConnection.netConnectionName,
      nominalTraceWidth: originalConnection.nominalTraceWidth,
      required: isSourceTraceConnection(originalConnection),
    })
  }

  return edges
}

export const getEdgeKey = (
  edge: Pick<WeightedConnectionPointEdge, "from" | "to">,
): string => {
  const fromKey = getPointKey(edge.from)
  const toKey = getPointKey(edge.to)
  return fromKey < toKey ? `${fromKey}::${toKey}` : `${toKey}::${fromKey}`
}

export const getRequiredOriginalEdges = (
  originalTwoPointEdges: OriginalTwoPointConnectionEdge[],
  pointIdToGroup: Map<string, number>,
): OriginalTwoPointConnectionEdge[] => {
  return originalTwoPointEdges.filter(
    (edge) =>
      edge.required &&
      !areExternallyConnected(pointIdToGroup, edge.from, edge.to),
  )
}

export const getExternalConnectionState = (
  connection: SimpleRouteConnection,
  srj?: SimpleRouteJson,
): ExternalConnectionState => {
  const externalGroups = connection.externallyConnectedPointIds ?? []
  const routedTraceGroups = getTraceConnectedPointGroups(connection, srj)
  const allExternalGroups = [...externalGroups, ...routedTraceGroups]
  const pointById = new Map<string, ConnectionPoint>()
  const pointByKey = new Map<string, ConnectionPoint>()

  for (const point of connection.pointsToConnect) {
    pointByKey.set(getPointKey(point), point)
    if (point.pointId) {
      pointById.set(point.pointId, point)
    }
  }

  const { pointIdToGroup, zeroWeightEdges } = buildExternalConnectionGroups(
    allExternalGroups,
    pointById,
  )
  const originalTwoPointEdges = getOriginalTwoPointEdges(
    connection,
    srj,
    pointByKey,
  )

  return { pointIdToGroup, zeroWeightEdges, originalTwoPointEdges }
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
    const { pointIdToGroup, zeroWeightEdges, originalTwoPointEdges } =
      getExternalConnectionState(connection, this.ogSrj)
    const requiredOriginalEdges = getRequiredOriginalEdges(
      originalTwoPointEdges,
      pointIdToGroup,
    )
    const requiredOriginalEdgeKeys = new Set(
      requiredOriginalEdges.map(getEdgeKey),
    )

    for (const edge of requiredOriginalEdges) {
      this.newConnections.push({
        pointsToConnect: [edge.from, edge.to],
        name: edge.name,
        rootConnectionName: connection.rootConnectionName ?? connection.name,
        mergedConnectionNames: connection.mergedConnectionNames,
        netConnectionName:
          edge.netConnectionName ?? connection.netConnectionName,
        nominalTraceWidth:
          edge.nominalTraceWidth ?? connection.nominalTraceWidth,
      })
    }

    if (connection.pointsToConnect.length === 2) {
      if (requiredOriginalEdges.length > 0) return
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
        rootConnectionName: connection.rootConnectionName ?? connection.name,
      })
      return
    }

    const edges = buildMinimumSpanningTree(connection.pointsToConnect, {
      extraEdges: [...zeroWeightEdges, ...originalTwoPointEdges],
    })

    let mstIdx = 0
    for (const edge of edges) {
      if (areExternallyConnected(pointIdToGroup, edge.from, edge.to)) continue
      if (requiredOriginalEdgeKeys.has(getEdgeKey(edge))) continue
      this.newConnections.push({
        pointsToConnect: [edge.from, edge.to],
        name: `${connection.name}_mst${mstIdx++}`,
        rootConnectionName: connection.rootConnectionName ?? connection.name,
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
