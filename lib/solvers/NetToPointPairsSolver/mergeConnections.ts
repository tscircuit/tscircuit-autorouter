import {
  SimpleRouteConnection,
  ConnectionPoint,
  PointId,
  PointKey,
  ConnectionTempId,
} from "lib/types"
import { DSU } from "lib/utils/dsu"
import { getPointKey } from "lib/utils/getPointKey"

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
    const mergedNames: Set<string> = new Set()
    let isOffBoard = false
    const mergedExternallyConnectedPointIds: PointId[][] = []
    const mergedNetConnectionNames: Set<string> = new Set()
    let nominalTraceWidth: number | undefined = undefined

    simpleRouteConnectionGroup.forEach((simpleRouteConnection) => {
      // Collect unique points
      simpleRouteConnection.pointsToConnect.forEach((connectionPoint) =>
        uniqueConnectionPoints.set(
          getPointKey(connectionPoint),
          connectionPoint,
        ),
      )

      // Collect names
      mergedNames.add(simpleRouteConnection.name)

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
      if (simpleRouteConnection.netConnectionName) {
        mergedNetConnectionNames.add(simpleRouteConnection.netConnectionName)
      }

      // Take the nominalTraceWidth from the first connection for now
      // A more robust solution might average or pick the max/min based on context
      if (
        nominalTraceWidth === undefined &&
        simpleRouteConnection.nominalTraceWidth !== undefined
      ) {
        nominalTraceWidth = simpleRouteConnection.nominalTraceWidth
      }
    })

    // Create the new merged SimpleRouteConnection
    const newSimpleRouteConnection: SimpleRouteConnection = {
      name: Array.from(mergedNames).join("__"), // Combine original names
      pointsToConnect: Array.from(uniqueConnectionPoints.values()),
      isOffBoard: isOffBoard,
      // Only include if there are any mergedExternallyConnectedPointIds
      externallyConnectedPointIds:
        mergedExternallyConnectedPointIds.length > 0
          ? mergedExternallyConnectedPointIds
          : undefined,
      netConnectionName:
        mergedNetConnectionNames.size > 0
          ? Array.from(mergedNetConnectionNames).join("__") // Combine unique net connection names
          : undefined,
      nominalTraceWidth: nominalTraceWidth, // Keep the first found nominalTraceWidth
    }

    mergedSimpleRouteConnections.push(newSimpleRouteConnection)
  }

  return mergedSimpleRouteConnections
}
