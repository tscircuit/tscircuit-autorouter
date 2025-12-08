import type { CapacityMeshNode, CapacityMeshNodeId, Obstacle } from "lib/types"
import type { SegmentWithAssignedPoints } from "lib/solvers/CapacityMeshSolver/CapacitySegmentToPointSolver"
import { boundsDistance, pointToBoxDistance } from "@tscircuit/math-utils"

export function collectNearbyObstaclesForCapacityNodes(params: {
  capacityMeshNodeList: CapacityMeshNode[]
  obstacleList: Obstacle[]
  clearanceThreshold: number
}): {
  capacityMeshNodeIdList: CapacityMeshNodeId[]
  capacityMeshNodeIdToObstacleList: Map<CapacityMeshNodeId, Obstacle[]>
} {
  const capacityMeshNodeIdSet = new Set<CapacityMeshNodeId>()
  const capacityMeshNodeIdToObstacleList = new Map<
    CapacityMeshNodeId,
    Obstacle[]
  >()

  if (params.obstacleList.length === 0) {
    return {
      capacityMeshNodeIdList: [],
      capacityMeshNodeIdToObstacleList,
    }
  }

  for (const capacityMeshNode of params.capacityMeshNodeList) {
    if (capacityMeshNode._containsObstacle) {
      continue
    }

    const capacityMeshNodeHalfWidth = capacityMeshNode.width / 2
    const capacityMeshNodeHalfHeight = capacityMeshNode.height / 2
    const capacityMeshNodeBounds = {
      minX: capacityMeshNode.center.x - capacityMeshNodeHalfWidth,
      maxX: capacityMeshNode.center.x + capacityMeshNodeHalfWidth,
      minY: capacityMeshNode.center.y - capacityMeshNodeHalfHeight,
      maxY: capacityMeshNode.center.y + capacityMeshNodeHalfHeight,
    }

    for (const obstacle of params.obstacleList) {
      const obstacleZLayers = obstacle.zLayers ?? []
      const hasSharedZLayer = obstacleZLayers.some((zLayer) =>
        capacityMeshNode.availableZ.includes(zLayer),
      )
      if (!hasSharedZLayer) {
        continue
      }

      const obstacleHalfWidth = obstacle.width / 2
      const obstacleHalfHeight = obstacle.height / 2
      const obstacleBounds = {
        minX: obstacle.center.x - obstacleHalfWidth,
        maxX: obstacle.center.x + obstacleHalfWidth,
        minY: obstacle.center.y - obstacleHalfHeight,
        maxY: obstacle.center.y + obstacleHalfHeight,
      }

      const distanceBetweenBounds = boundsDistance(
        capacityMeshNodeBounds,
        obstacleBounds,
      )

      if (distanceBetweenBounds <= 0) {
        continue
      }

      if (distanceBetweenBounds <= params.clearanceThreshold) {
        capacityMeshNodeIdSet.add(capacityMeshNode.capacityMeshNodeId)
        const obstacleListForNode =
          capacityMeshNodeIdToObstacleList.get(
            capacityMeshNode.capacityMeshNodeId,
          ) ?? []
        obstacleListForNode.push(obstacle)
        capacityMeshNodeIdToObstacleList.set(
          capacityMeshNode.capacityMeshNodeId,
          obstacleListForNode,
        )
      }
    }
  }

  return {
    capacityMeshNodeIdList: Array.from(capacityMeshNodeIdSet),
    capacityMeshNodeIdToObstacleList,
  }
}

export function isAxisAlignedSegmentCluster(params: {
  clusterEntries: { segment: SegmentWithAssignedPoints; pointIndex: number }[]
}): boolean {
  const { clusterEntries } = params
  if (clusterEntries.length < 2) return false

  const epsilon = 1e-6
  const firstPoint =
    clusterEntries[0].segment.assignedPoints![clusterEntries[0].pointIndex]
      .point

  let allSameX = true
  let allSameY = true

  for (const { segment, pointIndex } of clusterEntries) {
    const point = segment.assignedPoints![pointIndex].point
    if (Math.abs(point.x - firstPoint.x) > epsilon) allSameX = false
    if (Math.abs(point.y - firstPoint.y) > epsilon) allSameY = false
    if (!allSameX && !allSameY) {
      return false
    }
  }

  return allSameX || allSameY
}
