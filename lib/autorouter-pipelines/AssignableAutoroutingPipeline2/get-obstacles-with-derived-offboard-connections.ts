import type { Obstacle } from "lib/types"

/**
 * Treat a shared `connectedTo` id on assignable obstacles as a prefab
 * connection. Explicit `offBoardConnectsTo` metadata is preserved and merged
 * with any derived prefab connections.
 */
export const getObstaclesWithDerivedOffboardConnections = (
  obstacles: Obstacle[],
): Obstacle[] => {
  const assignableConnectionCounts = new Map<string, number>()

  for (const obstacle of obstacles) {
    if (!obstacle.netIsAssignable) continue
    for (const connectionId of new Set(obstacle.connectedTo)) {
      assignableConnectionCounts.set(
        connectionId,
        (assignableConnectionCounts.get(connectionId) ?? 0) + 1,
      )
    }
  }

  return obstacles.map((obstacle) => {
    const offboardConnectionIds = new Set(obstacle.offBoardConnectsTo ?? [])
    if (obstacle.netIsAssignable) {
      for (const connectionId of obstacle.connectedTo) {
        if ((assignableConnectionCounts.get(connectionId) ?? 0) >= 2) {
          offboardConnectionIds.add(connectionId)
        }
      }
    }

    if (offboardConnectionIds.size === 0) return obstacle
    return {
      ...obstacle,
      offBoardConnectsTo: [...offboardConnectionIds],
    }
  })
}
