import type { CapacityMeshNode } from "lib/types"
import type { SimpleRouteJson } from "lib/types"

export interface WeightedCrossingCounts {
  numSameLayerCrossings: number
  numEntryExitLayerChanges: number
  numTransitionPairCrossings: number
  numProximityWeightedSameLayerCrossings: number
  numProximityWeightedEntryExitLayerChanges: number
  numProximityWeightedTransitionPairCrossings: number
}

/**
 * Apply obstacle proximity weighting to crossing counts.
 *
 * Crossings that occur in regions with obstacles count for more in the
 * probability of failure calculation because routing through congested
 * areas with obstacles is more difficult and likely to fail.
 *
 * The weighting scales up to 2.57x based on the number of obstacles
 * intersecting a node's bounding box:
 * - 0 obstacles: 1.0x (no penalty)
 * - 1 obstacle: 1.2x
 * - 2 obstacles: 1.35x
 * - 3 obstacles: 1.5x
 * - each additional obstacle adds 0.15x
 *
 * This encourages the router to avoid creating crossings in areas with
 * many obstacles, which would otherwise be difficult to route successfully.
 */
function countObstaclesNearNode(
  node: CapacityMeshNode,
  obstacles: SimpleRouteJson["obstacles"] = [],
): number {
  if (!obstacles || obstacles.length === 0) return 0

  const nodeMinX = node.center.x - node.width / 2
  const nodeMaxX = node.center.x + node.width / 2
  const nodeMinY = node.center.y - node.height / 2
  const nodeMaxY = node.center.y + node.height / 2

  // Check obstacles that have center and width/height (rects)
  // We count obstacles that intersect or are near the node's bounding box
  let count = 0
  for (const obstacle of obstacles) {
    if (obstacle.type !== "rect") continue

    const obsMinX = obstacle.center.x - obstacle.width / 2
    const obsMaxX = obstacle.center.x + obstacle.width / 2
    const obsMinY = obstacle.center.y - obstacle.height / 2
    const obsMaxY = obstacle.center.y + obstacle.height / 2

    // Check if obstacle bounding box intersects node bounding box
    const intersects =
      nodeMinX <= obsMaxX &&
      nodeMaxX >= obsMinX &&
      nodeMinY <= obsMaxY &&
      nodeMaxY >= obsMinY

    if (intersects) {
      count++
    }
  }

  return count
}

/**
 * Calculate a proximity weight factor based on number of nearby obstacles.
 * Returns a multiplier where:
 * - 0 obstacles: factor = 1.0 (no penalty)
 * - 1 obstacle: factor = 1.2
 * - 2+ obstacles: factor = 1.2 + (obstacleCount - 1) * 0.15
 */
function calculateProximityWeightFactor(obstacleCount: number): number {
  if (obstacleCount === 0) return 1.0
  if (obstacleCount === 1) return 1.2
  return 1.2 + (obstacleCount - 1) * 0.15
}

/**
 * Apply obstacle-proximity weighting to crossing counts.
 * Crossings in areas with more obstacles count for more.
 */
export function applyObstacleProximityWeighting(
  node: CapacityMeshNode,
  numSameLayerCrossings: number,
  numEntryExitLayerChanges: number,
  numTransitionPairCrossings: number,
  simpleRouteJson?: SimpleRouteJson,
): WeightedCrossingCounts {
  // Count obstacles near this node
  const nearObstacles = countObstaclesNearNode(
    node,
    simpleRouteJson?.obstacles ?? [],
  )

  // Calculate proximity weight factor
  const weightFactor = calculateProximityWeightFactor(nearObstacles)

  return {
    numSameLayerCrossings,
    numEntryExitLayerChanges,
    numTransitionPairCrossings,
    // Weighted versions - crossing counts multiplied by proximity factor
    numProximityWeightedSameLayerCrossings:
      numSameLayerCrossings * weightFactor,
    numProximityWeightedEntryExitLayerChanges:
      numEntryExitLayerChanges * weightFactor,
    numProximityWeightedTransitionPairCrossings:
      numTransitionPairCrossings * weightFactor,
  }
}
