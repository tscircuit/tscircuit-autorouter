import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { CapacityMeshNode, CapacityMeshNodeId, Obstacle } from "lib/types"
import type { SegmentWithAssignedPoints } from "lib/solvers/CapacityMeshSolver/CapacitySegmentToPointSolver"
import {
  boundsDistance,
  getUnitVectorFromPointAToB,
  pointToBoxDistance,
} from "@tscircuit/math-utils"

export interface SegmentPointClearanceContext {
  capacityMeshNodeList: CapacityMeshNode[]
  obstacleList: Obstacle[]
  minimumTraceWidth: number
  clearanceThreshold: number
}

export class CapacitySegmentPointClearanceSolver extends BaseSolver {
  segmentList: SegmentWithAssignedPoints[]
  context: SegmentPointClearanceContext
  capacityMeshNodeIdWithNearbyObstacleList: CapacityMeshNodeId[]
  capacityMeshNodeById: Map<CapacityMeshNodeId, CapacityMeshNode>
  capacityMeshNodeIdToObstacleList!: Map<CapacityMeshNodeId, Obstacle[]>

  constructor(params: {
    segmentList: SegmentWithAssignedPoints[]
    context: SegmentPointClearanceContext
  }) {
    super()
    // All segments with assignedPoints that we might adjust.
    this.segmentList = params.segmentList
    // Shared context: capacity mesh nodes, obstacles and minimum trace width.
    this.context = params.context
    // Quick lookup for capacity mesh nodes by id.
    this.capacityMeshNodeById = new Map(
      this.context.capacityMeshNodeList.map((capacityMeshNode) => [
        capacityMeshNode.capacityMeshNodeId,
        capacityMeshNode,
      ]),
    )
    // Map of node id -> obstacles that are near that node.
    this.capacityMeshNodeIdToObstacleList = new Map()
    // Determine which nodes are near obstacles and populate the map above.
    this.capacityMeshNodeIdWithNearbyObstacleList =
      this.createCapacityMeshNodeIdWithNearbyObstacleList()
    // Only keep segments that belong to nodes we actually care about.
    this.segmentList = this.segmentList.filter((segment) =>
      this.capacityMeshNodeIdWithNearbyObstacleList.includes(
        segment.capacityMeshNodeId,
      ),
    )
  }

  private createCapacityMeshNodeIdWithNearbyObstacleList(): CapacityMeshNodeId[] {
    // Unique set of node ids that are near at least one obstacle.
    const capacityMeshNodeIdSet = new Set<CapacityMeshNodeId>()
    // Reset the node->obstacle mapping each time we rebuild this list.
    this.capacityMeshNodeIdToObstacleList = new Map()

    // If there are no obstacles at all, nothing to do.
    if (this.context.obstacleList.length === 0) {
      return []
    }

    // How close a node boundary can be to an obstacle before we care.
    const clearanceThreshold = this.context.clearanceThreshold

    // Walk every capacity mesh node and check its proximity to all obstacles.
    for (const capacityMeshNode of this.context.capacityMeshNodeList) {
      if (capacityMeshNode._containsObstacle) {
        // Nodes that contain obstacles are not candidates for
        // clearance-based point adjustment.
        continue
      }

      // Compute simple bounds for the capacity mesh node.
      const capacityMeshNodeHalfWidth = capacityMeshNode.width / 2
      const capacityMeshNodeHalfHeight = capacityMeshNode.height / 2
      const capacityMeshNodeBounds = {
        minX: capacityMeshNode.center.x - capacityMeshNodeHalfWidth,
        maxX: capacityMeshNode.center.x + capacityMeshNodeHalfWidth,
        minY: capacityMeshNode.center.y - capacityMeshNodeHalfHeight,
        maxY: capacityMeshNode.center.y + capacityMeshNodeHalfHeight,
      }

      // Check this node against every obstacle.
      for (const obstacle of this.context.obstacleList) {
        // Compute bounds for the obstacle rectangle.
        const obstacleHalfWidth = obstacle.width / 2
        const obstacleHalfHeight = obstacle.height / 2
        const obstacleBounds = {
          minX: obstacle.center.x - obstacleHalfWidth,
          maxX: obstacle.center.x + obstacleHalfWidth,
          minY: obstacle.center.y - obstacleHalfHeight,
          maxY: obstacle.center.y + obstacleHalfHeight,
        }

        // Minimum distance between the node bounds and obstacle bounds.
        const distanceBetweenBounds = boundsDistance(
          capacityMeshNodeBounds,
          obstacleBounds,
        )

        // If the obstacle is within the clearance band, record it for this node.
        if (distanceBetweenBounds <= clearanceThreshold) {
          capacityMeshNodeIdSet.add(capacityMeshNode.capacityMeshNodeId)
          const obstacleListForNode =
            this.capacityMeshNodeIdToObstacleList.get(
              capacityMeshNode.capacityMeshNodeId,
            ) ?? []
          obstacleListForNode.push(obstacle)
          this.capacityMeshNodeIdToObstacleList.set(
            capacityMeshNode.capacityMeshNodeId,
            obstacleListForNode,
          )
        }
      }
    }

    // Return the list of node ids that are near at least one obstacle.
    return Array.from(capacityMeshNodeIdSet)
  }

  _step() {
    for (const segment of this.segmentList) {
      if (!segment.assignedPoints || segment.assignedPoints.length === 0) {
        continue
      }

      const capacityMeshNode = this.capacityMeshNodeById.get(
        segment.capacityMeshNodeId,
      )
      if (!capacityMeshNode) {
        continue
      }

      for (const assignedPoint of segment.assignedPoints) {
        this.adjustAssignedPointIfNearObstacleBoundary({
          assignedPoint,
          segment,
          capacityMeshNode,
        })
      }
    }

    this.solved = true
  }

  private adjustAssignedPointIfNearObstacleBoundary(params: {
    assignedPoint: {
      connectionName: string
      point: { x: number; y: number; z: number }
    }
    segment: SegmentWithAssignedPoints
    capacityMeshNode: CapacityMeshNode
  }) {
    // If the point is too close to a nearby obstacle, push it inward toward the node center.
    const { assignedPoint, capacityMeshNode } = params

    // Get the obstacles that are near this capacity mesh node.
    const obstacleListForNode =
      this.capacityMeshNodeIdToObstacleList.get(
        capacityMeshNode.capacityMeshNodeId,
      ) ?? []

    // If there are no nearby obstacles, no adjustment is needed.
    if (obstacleListForNode.length === 0) {
      return
    }

    // Target clearance distance between the trace centerline and the obstacle.
    const clearanceThreshold = this.context.clearanceThreshold

    // Track the closest obstacle and its distance to this point.
    let closestObstacle: Obstacle | null = null
    let closestDistance = Infinity

    // Find the nearest obstacle to the current assigned point.
    for (const obstacle of obstacleListForNode) {
      // Represent the obstacle as a Box for pointToBoxDistance.
      const obstacleBox = {
        center: { x: obstacle.center.x, y: obstacle.center.y },
        width: obstacle.width,
        height: obstacle.height,
      }

      // Distance from the point to the obstacle rectangle (0 if inside).
      const distanceToObstacle = pointToBoxDistance(
        { x: assignedPoint.point.x, y: assignedPoint.point.y },
        obstacleBox,
      )

      // Keep the smallest distance and its obstacle.
      if (distanceToObstacle < closestDistance) {
        closestDistance = distanceToObstacle
        closestObstacle = obstacle
      }
    }

    // If we somehow did not find any obstacle, bail out.
    if (!closestObstacle) {
      return
    }

    // If we already have enough clearance, do not move the point.
    if (closestDistance > clearanceThreshold) {
      return
    }

    // Unit vector pointing from the current point toward the node center.
    const inwardUnit = getUnitVectorFromPointAToB(
      { x: assignedPoint.point.x, y: assignedPoint.point.y },
      { x: capacityMeshNode.center.x, y: capacityMeshNode.center.y },
    )

    // How far we need to nudge the point inward to reach the target clearance.
    const shiftDistance = clearanceThreshold - closestDistance

    // Apply the inward shift while preserving the original z layer.
    assignedPoint.point = {
      x: assignedPoint.point.x + inwardUnit.x * shiftDistance,
      y: assignedPoint.point.y + inwardUnit.y * shiftDistance,
      z: assignedPoint.point.z,
    }
  }

  visualize(): GraphicsObject {
    // For now just render nothing; we will extend this later to show
    // before/after point positions around obstacles.
    return {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }
  }
}
