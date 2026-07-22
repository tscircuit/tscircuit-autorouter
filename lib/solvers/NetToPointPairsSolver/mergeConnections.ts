import {
  SimpleRouteConnection,
  ConnectionPoint,
  PointId,
  PointKey,
  ConnectionTempId,
} from "lib/types"
import { DSU } from "lib/utils/dsu"
import { getPointKey } from "lib/utils/getPointKey"

type MstEdgeLike = {
  from: ConnectionPoint
  to: ConnectionPoint
}

/**
 * Resolves a nominalTraceWidth for every MST edge of a (possibly merged)
 * connection. Returns one width (or undefined) per edge, in edge order.
 *
 * For merged connections we use the width constraints recorded by
 * `mergeConnections`: an original connection with nominalTraceWidth W requires
 * every tree edge on the path between its points to be at least W, because the
 * MST may reroute that connection's current through edges whose endpoints
 * belong to other (possibly narrower) connections. Each edge takes the widest
 * width among the constraints whose path crosses it; edges crossed by no
 * constraint get no width and are routed at the default.
 *
 * For unmerged connections the connection's own nominalTraceWidth applies to
 * every edge.
 */
export function getNominalTraceWidthsForMstEdges(
  connection: SimpleRouteConnection,
  mstEdges: MstEdgeLike[],
): Array<number | undefined> {
  const constraints = connection.__nominalTraceWidthConstraints
  if (!constraints || constraints.length === 0) {
    return mstEdges.map(() => connection.nominalTraceWidth)
  }

  // Build tree adjacency: pointKey -> [neighbor pointKey, edge index]
  const adjacency = new Map<PointKey, Array<[PointKey, number]>>()
  mstEdges.forEach((mstEdge, edgeIndex) => {
    const fromKey = getPointKey(mstEdge.from)
    const toKey = getPointKey(mstEdge.to)
    if (!adjacency.has(fromKey)) adjacency.set(fromKey, [])
    if (!adjacency.has(toKey)) adjacency.set(toKey, [])
    adjacency.get(fromKey)!.push([toKey, edgeIndex])
    adjacency.get(toKey)!.push([fromKey, edgeIndex])
  })

  const edgeNominalTraceWidths: Array<number | undefined> = mstEdges.map(
    () => undefined,
  )

  for (const constraint of constraints) {
    const terminalKeys = constraint.pointKeys.filter((pointKey) =>
      adjacency.has(pointKey),
    )
    if (terminalKeys.length < 2) continue

    // BFS from the first terminal, recording each visited point's parent edge
    const rootKey = terminalKeys[0]
    const parentOf = new Map<PointKey, [PointKey, number]>()
    const visited = new Set<PointKey>([rootKey])
    const queue: PointKey[] = [rootKey]
    while (queue.length > 0) {
      const currentKey = queue.shift()!
      for (const [neighborKey, edgeIndex] of adjacency.get(currentKey) ?? []) {
        if (visited.has(neighborKey)) continue
        visited.add(neighborKey)
        parentOf.set(neighborKey, [currentKey, edgeIndex])
        queue.push(neighborKey)
      }
    }

    // Walk each remaining terminal back to the root; the union of these walks
    // is the minimal subtree spanning the constraint's points.
    const markedEdgeIndices = new Set<number>()
    for (let i = 1; i < terminalKeys.length; i++) {
      let walkKey: PointKey = terminalKeys[i]
      while (walkKey !== rootKey) {
        const parentEntry = parentOf.get(walkKey)
        if (!parentEntry) break // Terminal unreachable from root (disconnected)
        const [parentKey, edgeIndex] = parentEntry
        if (markedEdgeIndices.has(edgeIndex)) break // Already-walked branch
        markedEdgeIndices.add(edgeIndex)
        walkKey = parentKey
      }
    }

    for (const edgeIndex of markedEdgeIndices) {
      const existingWidth = edgeNominalTraceWidths[edgeIndex]
      edgeNominalTraceWidths[edgeIndex] =
        existingWidth === undefined
          ? constraint.nominalTraceWidth
          : Math.max(existingWidth, constraint.nominalTraceWidth)
    }
  }

  return edgeNominalTraceWidths
}

/**
 * Merges SimpleRouteConnections that share common ConnectionPoints into single connections.
 * This is useful for grouping related traces/nets that were defined separately
 * but are electrically connected through shared points.
 *
 * @param simpleRouteConnections An array of SimpleRouteConnection objects to merge.
 * @returns A new array of merged SimpleRouteConnection objects.
 */
export function mergeConnections(
  simpleRouteConnections: SimpleRouteConnection[],
): SimpleRouteConnection[] {
  if (simpleRouteConnections.length === 0) {
    return []
  }

  // Assign a unique temporary ID to each connection for DSU tracking
  const connectionTempIds: ConnectionTempId[] = simpleRouteConnections.map(
    (_, i) => `conn_${i}`,
  )
  const disjointSetUnion = new DSU(connectionTempIds)

  // Map each unique point to the list of connection IDs that touch it
  const pointKeyToConnectionTempIds = new Map<PointKey, ConnectionTempId[]>()

  simpleRouteConnections.forEach((simpleRouteConnection, index) => {
    const connectionTempId: ConnectionTempId = `conn_${index}`
    simpleRouteConnection.pointsToConnect.forEach((connectionPoint) => {
      const pointKey: PointKey = getPointKey(connectionPoint)
      if (!pointKeyToConnectionTempIds.has(pointKey)) {
        pointKeyToConnectionTempIds.set(pointKey, [])
      }
      pointKeyToConnectionTempIds.get(pointKey)!.push(connectionTempId)
    })
  })

  // Perform unions for connections that share any common point
  for (const connectionTempIdsSharingPoint of pointKeyToConnectionTempIds.values()) {
    if (connectionTempIdsSharingPoint.length > 1) {
      // Union all connections that share this point
      const firstConnectionTempId = connectionTempIdsSharingPoint[0]
      for (let i = 1; i < connectionTempIdsSharingPoint.length; i++) {
        disjointSetUnion.union(
          firstConnectionTempId,
          connectionTempIdsSharingPoint[i],
        )
      }
    }
  }

  // Group original connections by their DSU root (representing the merged net)
  const connectionTempIdGroups = new Map<
    ConnectionTempId,
    SimpleRouteConnection[]
  >() // Key is ConnectionTempId (the root)
  simpleRouteConnections.forEach((simpleRouteConnection, index) => {
    const connectionTempId: ConnectionTempId = `conn_${index}`
    const rootConnectionTempId: ConnectionTempId =
      disjointSetUnion.find(connectionTempId)
    if (!connectionTempIdGroups.has(rootConnectionTempId)) {
      connectionTempIdGroups.set(rootConnectionTempId, [])
    }
    connectionTempIdGroups
      .get(rootConnectionTempId)!
      .push(simpleRouteConnection)
  })

  const mergedSimpleRouteConnections: SimpleRouteConnection[] = []

  // Construct the new merged connections
  for (const simpleRouteConnectionGroup of connectionTempIdGroups.values()) {
    if (simpleRouteConnectionGroup.length === 1) {
      mergedSimpleRouteConnections.push(simpleRouteConnectionGroup[0])
      continue // No merging needed for groups of one
    }

    const uniqueConnectionPoints = new Map<PointKey, ConnectionPoint>()
    const mergedRootConnectionNames: Set<string> = new Set()
    let isOffBoard = false
    const mergedExternallyConnectedPointIds: PointId[][] = []
    const mergedNetConnectionNames: Set<string> = new Set()
    let nominalTraceWidth: number | undefined = undefined
    const nominalTraceWidthConstraints: Array<{
      nominalTraceWidth: number
      pointKeys: PointKey[]
    }> = []

    simpleRouteConnectionGroup.forEach((simpleRouteConnection) => {
      // Collect unique points
      simpleRouteConnection.pointsToConnect.forEach((connectionPoint) =>
        uniqueConnectionPoints.set(
          getPointKey(connectionPoint),
          connectionPoint,
        ),
      )

      const rootConnectionNames = simpleRouteConnection.__rootConnectionNames
      if (rootConnectionNames && rootConnectionNames.length > 0) {
        for (const rootConnectionName of rootConnectionNames) {
          mergedRootConnectionNames.add(rootConnectionName)
        }
      } else {
        mergedRootConnectionNames.add(simpleRouteConnection.name)
      }

      // Merge isOffBoard property
      if (simpleRouteConnection.isOffBoard) {
        isOffBoard = true
      }

      // Merge externallyConnectedPointIds
      if (simpleRouteConnection.externallyConnectedPointIds) {
        mergedExternallyConnectedPointIds.push(
          ...simpleRouteConnection.externallyConnectedPointIds,
        )
      }

      // Collect netConnectionNames (deduplicate)
      if (simpleRouteConnection.__netConnectionName) {
        mergedNetConnectionNames.add(simpleRouteConnection.__netConnectionName)
      }

      // Record each connection's nominalTraceWidth and points as a width
      // constraint so MST edges can later resolve a per-edge width (see
      // getNominalTraceWidthsForMstEdges). Nested constraints from an earlier
      // merge are carried through unchanged. The merged connection's own
      // nominalTraceWidth is the widest in the group (order-independent).
      if (simpleRouteConnection.__nominalTraceWidthConstraints) {
        nominalTraceWidthConstraints.push(
          ...simpleRouteConnection.__nominalTraceWidthConstraints,
        )
      } else if (simpleRouteConnection.nominalTraceWidth !== undefined) {
        nominalTraceWidthConstraints.push({
          nominalTraceWidth: simpleRouteConnection.nominalTraceWidth,
          pointKeys: simpleRouteConnection.pointsToConnect.map(getPointKey),
        })
      }
      if (simpleRouteConnection.nominalTraceWidth !== undefined) {
        nominalTraceWidth =
          nominalTraceWidth === undefined
            ? simpleRouteConnection.nominalTraceWidth
            : Math.max(
                nominalTraceWidth,
                simpleRouteConnection.nominalTraceWidth,
              )
      }
    })

    // Create the new merged SimpleRouteConnection
    const newSimpleRouteConnection: SimpleRouteConnection = {
      name: simpleRouteConnectionGroup
        .map((connection) => connection.name)
        .join("__"),
      pointsToConnect: Array.from(uniqueConnectionPoints.values()),
      isOffBoard: isOffBoard,
      // Only include if there are any mergedExternallyConnectedPointIds
      externallyConnectedPointIds:
        mergedExternallyConnectedPointIds.length > 0
          ? mergedExternallyConnectedPointIds
          : undefined,
      __netConnectionName:
        mergedNetConnectionNames.size > 0
          ? Array.from(mergedNetConnectionNames).join("__") // Combine unique net connection names
          : undefined,
      __rootConnectionNames: Array.from(mergedRootConnectionNames),
      nominalTraceWidth: nominalTraceWidth, // Widest nominalTraceWidth in the group
      __nominalTraceWidthConstraints:
        nominalTraceWidthConstraints.length > 0
          ? nominalTraceWidthConstraints
          : undefined,
    }

    mergedSimpleRouteConnections.push(newSimpleRouteConnection)
  }

  return mergedSimpleRouteConnections
}
