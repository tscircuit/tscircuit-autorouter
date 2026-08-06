import {
  type Bounds,
  doBoundsOverlap,
  getBoundFromCenteredRect,
} from "@tscircuit/math-utils"
import type { CapacityMeshNode, Obstacle } from "lib/types"

export const GEOMETRY_EPSILON = 1e-9

export function getCapacityMeshNodeBounds(node: CapacityMeshNode): Bounds {
  return getBoundFromCenteredRect({
    center: node.center,
    width: node.width,
    height: node.height,
  })
}

export function getBoundsIntersection(
  boundsA: Bounds,
  boundsB: Bounds,
): Bounds | null {
  const intersection = {
    minX: Math.max(boundsA.minX, boundsB.minX),
    maxX: Math.min(boundsA.maxX, boundsB.maxX),
    minY: Math.max(boundsA.minY, boundsB.minY),
    maxY: Math.min(boundsA.maxY, boundsB.maxY),
  }

  if (!isValidCapacityBounds(intersection)) return null

  return intersection
}

export function isValidCapacityBounds(bounds: Bounds): boolean {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const hasValidWidth = Number.isFinite(width) && width > GEOMETRY_EPSILON
  const hasValidHeight = Number.isFinite(height) && height > GEOMETRY_EPSILON

  return hasValidWidth && hasValidHeight
}

/**
 * Removes obstacles that are thinner than GEOMETRY_EPSILON in either dimension.
 *
 * Topology generation turns every obstacle rect into capacity mesh nodes, and a
 * rect below GEOMETRY_EPSILON produces a node that `isValidCapacityBounds`
 * rejects, so it aborts TopologyMergingSolver input validation. Such a rect also
 * carries no routable or blocking area: it cannot hold a port point and no trace
 * can collide with it. Topology planning drops it at its input so every stage
 * uses one definition of real geometry.
 */
export function dropDegenerateObstacles(obstacles: Obstacle[]): Obstacle[] {
  return obstacles.filter((obstacle) => {
    const obstacleBounds = getBoundFromCenteredRect({
      center: obstacle.center,
      width: obstacle.width,
      height: obstacle.height,
    })

    return isValidCapacityBounds(obstacleBounds)
  })
}

export function isNodeInsideOrOverlappingObstacle({
  node,
  obstacle,
}: {
  node: CapacityMeshNode
  obstacle: Obstacle
}): boolean {
  const nodeBounds = getCapacityMeshNodeBounds(node)
  const obstacleBounds = getBoundFromCenteredRect({
    center: obstacle.center,
    width: obstacle.width,
    height: obstacle.height,
  })

  return doBoundsOverlap(nodeBounds, obstacleBounds)
}

export function isNodeCenterInsideObstacle({
  node,
  obstacle,
}: {
  node: CapacityMeshNode
  obstacle: Obstacle
}): boolean {
  const obstacleBounds = getBoundFromCenteredRect({
    center: obstacle.center,
    width: obstacle.width,
    height: obstacle.height,
  })
  const centerInsideX =
    node.center.x >= obstacleBounds.minX - GEOMETRY_EPSILON &&
    node.center.x <= obstacleBounds.maxX + GEOMETRY_EPSILON
  const centerInsideY =
    node.center.y >= obstacleBounds.minY - GEOMETRY_EPSILON &&
    node.center.y <= obstacleBounds.maxY + GEOMETRY_EPSILON

  return centerInsideX && centerInsideY
}
