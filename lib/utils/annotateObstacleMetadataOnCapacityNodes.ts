import type { CapacityMeshNode, Obstacle } from "lib/types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { doRectsOverlap } from "lib/utils/doRectsOverlap"

/**
 * Reattaches obstacle provenance to capacity mesh nodes produced by pipelines
 * that do not run through CapacityMeshNodeSolver.
 */
export const annotateObstacleMetadataOnCapacityNodes = ({
  nodes,
  obstacles,
  layerCount = 2,
}: {
  nodes: CapacityMeshNode[]
  obstacles: ReadonlyArray<Obstacle>
  layerCount?: number
}) => {
  const normalizedObstacles = createObjectsWithZLayers(obstacles, layerCount)

  for (const [index, obstacle] of normalizedObstacles.entries()) {
    const obstacleId = obstacle.obstacleId ?? `__obstacle_${index}`
    const obstacleRootId =
      obstacle.parentObstacleId ??
      obstacle.obstacleId ??
      `__obstacle_root_${index}`

    for (const node of nodes) {
      if (!node.availableZ.some((z) => obstacle.zLayers.includes(z))) {
        continue
      }

      if (!doRectsOverlap(node, obstacle)) {
        continue
      }

      node._obstacleIds ??= []
      if (!node._obstacleIds.includes(obstacleId)) {
        node._obstacleIds.push(obstacleId)
      }

      node._obstacleRootIds ??= []
      if (!node._obstacleRootIds.includes(obstacleRootId)) {
        node._obstacleRootIds.push(obstacleRootId)
      }
    }
  }

  return nodes
}
