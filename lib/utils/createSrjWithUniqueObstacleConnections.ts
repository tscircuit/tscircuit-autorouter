import type { Obstacle, SimpleRouteJson } from "lib/types"

function createObstaclesWithUniqueConnections(
  obstacles: Obstacle[],
  connectionsByInput: Map<string[], string[]>,
): Obstacle[] {
  let result = obstacles
  for (const [index, obstacle] of obstacles.entries()) {
    let uniqueConnections = connectionsByInput.get(obstacle.connectedTo)
    if (!uniqueConnections) {
      const distinctIds = new Set(obstacle.connectedTo)
      uniqueConnections = distinctIds.size === obstacle.connectedTo.length
        ? obstacle.connectedTo
        : [...distinctIds]
      connectionsByInput.set(obstacle.connectedTo, uniqueConnections)
    }
    if (uniqueConnections === obstacle.connectedTo) continue

    if (result === obstacles) result = [...obstacles]
    result[index] = {
      ...obstacle,
      connectedTo: uniqueConnections,
    }
  }
  return result
}

/**
 * Repeated memberships add no routing connectivity. Preserve first-occurrence
 * order and every distinct alias: some consumers use the first ID or compare
 * exact route names. Circuit JSON provenance must remain in its metadata field.
 */
export function createSrjWithUniqueObstacleConnections(
  srj: SimpleRouteJson,
): SimpleRouteJson {
  // Plane approximations can share the same large membership array across
  // hundreds of obstacles. Normalize it once and preserve that sharing.
  const connectionsByInput = new Map<string[], string[]>()
  const obstacles = createObstaclesWithUniqueConnections(srj.obstacles, connectionsByInput)
  let jumpers = srj.jumpers
  if (srj.jumpers) {
    for (const [index, jumper] of srj.jumpers.entries()) {
      const pads = createObstaclesWithUniqueConnections(jumper.pads, connectionsByInput)
      if (pads === jumper.pads) continue

      if (jumpers === srj.jumpers) jumpers = [...srj.jumpers]
      jumpers![index] = { ...jumper, pads }
    }
  }
  if (obstacles === srj.obstacles && jumpers === srj.jumpers) return srj
  return { ...srj, obstacles, ...(jumpers ? { jumpers } : {}) }
}
