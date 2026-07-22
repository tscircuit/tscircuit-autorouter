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
import { getPointKey } from "lib/utils/getPointKey"

type OriginalConnectionRecord = {
  connection: SimpleRouteConnection
  originalIndex: number
}

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
  protected originalConnectionByName: Map<string, OriginalConnectionRecord>
  protected mergedConnectionConstituents: Map<
    SimpleRouteConnection,
    SimpleRouteConnection[]
  >

  constructor(
    public ogSrj: SimpleRouteJson,
    public colorMap: Record<string, string> = {},
    public originalSrj: SimpleRouteJson = ogSrj,
  ) {
    super()
    this.originalConnectionByName = new Map()
    for (const [
      originalIndex,
      connection,
    ] of originalSrj.connections.entries()) {
      if (this.originalConnectionByName.has(connection.name)) {
        throw new Error(
          `Original SimpleRouteJson contains duplicate connection name "${connection.name}"`,
        )
      }
      this.originalConnectionByName.set(connection.name, {
        connection,
        originalIndex,
      })
    }

    const constituentConnections = [...ogSrj.connections]
    for (const connection of constituentConnections) {
      if (!this.originalConnectionByName.has(connection.name)) {
        throw new Error(
          `Could not match pre-merge connection "${connection.name}" to an original SimpleRouteJson connection`,
        )
      }
    }

    this.unprocessedConnections = mergeConnections(constituentConnections)
    this.mergedConnectionConstituents = this.associateMergedConnections(
      constituentConnections,
    )
    this.newConnections = []
  }

  protected associateMergedConnections(
    constituentConnections: SimpleRouteConnection[],
  ): Map<SimpleRouteConnection, SimpleRouteConnection[]> {
    const constituentsByMergedConnection = new Map<
      SimpleRouteConnection,
      SimpleRouteConnection[]
    >(this.unprocessedConnections.map((connection) => [connection, []]))
    const mergedConnectionByPointKey = new Map<string, SimpleRouteConnection>()

    for (const mergedConnection of this.unprocessedConnections) {
      for (const point of mergedConnection.pointsToConnect) {
        mergedConnectionByPointKey.set(getPointKey(point), mergedConnection)
      }
    }

    for (const constituent of constituentConnections) {
      const mergedConnection =
        this.unprocessedConnections.find(
          (connection) => connection === constituent,
        ) ??
        constituent.pointsToConnect
          .map((point) => mergedConnectionByPointKey.get(getPointKey(point)))
          .find(
            (connection): connection is SimpleRouteConnection =>
              connection !== undefined,
          )

      if (!mergedConnection) {
        throw new Error(
          `Could not associate pre-merge connection "${constituent.name}" with a merged connection`,
        )
      }
      constituentsByMergedConnection.get(mergedConnection)!.push(constituent)
    }

    return constituentsByMergedConnection
  }

  protected selectOriginalSrjConnectionName(
    mergedConnection: SimpleRouteConnection,
    firstEndpoint: ConnectionPoint,
    secondEndpoint: ConnectionPoint,
  ): string {
    const constituents =
      this.mergedConnectionConstituents.get(mergedConnection) ?? []
    const candidateByOriginalIndex = new Map<number, OriginalConnectionRecord>()

    for (const constituent of constituents) {
      const originalRecord = this.originalConnectionByName.get(constituent.name)
      if (!originalRecord) {
        throw new Error(
          `Could not match pre-merge connection "${constituent.name}" to an original SimpleRouteJson connection`,
        )
      }
      candidateByOriginalIndex.set(originalRecord.originalIndex, originalRecord)
    }

    const candidates = Array.from(candidateByOriginalIndex.values()).sort(
      (a, b) => a.originalIndex - b.originalIndex,
    )
    if (candidates.length === 0) {
      throw new Error(
        `Merged connection "${mergedConnection.name}" has no original provenance candidates`,
      )
    }

    const firstEndpointKey = getPointKey(firstEndpoint)
    const secondEndpointKey = getPointKey(secondEndpoint)
    const exactOwners = candidates.filter(({ connection }) => {
      const pointKeys = new Set(connection.pointsToConnect.map(getPointKey))
      return pointKeys.has(firstEndpointKey) && pointKeys.has(secondEndpointKey)
    })

    // A global MST edge can join points that never shared an original
    // connection. In that case this is deterministic attribution, not proof
    // that the selected original connection contained both endpoints.
    const selectionPool = exactOwners.length > 0 ? exactOwners : candidates
    let selected = selectionPool[0]!
    let selectedWidth =
      selected.connection.nominalTraceWidth ??
      this.originalSrj.nominalTraceWidth ??
      this.originalSrj.minTraceWidth

    for (let i = 1; i < selectionPool.length; i++) {
      const candidate = selectionPool[i]!
      const candidateWidth =
        candidate.connection.nominalTraceWidth ??
        this.originalSrj.nominalTraceWidth ??
        this.originalSrj.minTraceWidth
      if (candidateWidth > selectedWidth) {
        selected = candidate
        selectedWidth = candidateWidth
      }
    }

    return selected.connection.name
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
        __originalSrjConnectionName: this.selectOriginalSrjConnectionName(
          connection,
          connection.pointsToConnect[0],
          connection.pointsToConnect[1],
        ),
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
        __rootConnectionNames: connection.__rootConnectionNames ?? [
          connection.name,
        ],
        __netConnectionName: connection.__netConnectionName,
        __originalSrjConnectionName: this.selectOriginalSrjConnectionName(
          connection,
          edge.from,
          edge.to,
        ),
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
