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

type ConnectionName = string

type ConnectionClusterEntry = {
  segment: SegmentWithAssignedPoints
  pointIndex: number
}

type ConnectionClusterMap = Map<ConnectionName, ConnectionClusterEntry[]>

type NodeClusterMap = Map<CapacityMeshNodeId, ConnectionClusterMap>

export class CapacitySegmentPointClearanceSolver extends BaseSolver {
  segmentList: SegmentWithAssignedPoints[]
  context: SegmentPointClearanceContext
  capacityMeshNodeIdWithNearbyObstacleList: CapacityMeshNodeId[]
  capacityMeshNodeById: Map<CapacityMeshNodeId, CapacityMeshNode>
  capacityMeshNodeIdToObstacleList!: Map<CapacityMeshNodeId, Obstacle[]>
  clusterMap!: NodeClusterMap

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

    console.log("[CapacitySegmentPointClearanceSolver] constructor", {
      segmentCount: this.segmentList.length,
      capacityMeshNodeCount: this.context.capacityMeshNodeList.length,
      obstacleCount: this.context.obstacleList.length,
      nearbyNodeCount: this.capacityMeshNodeIdWithNearbyObstacleList.length,
      clearanceThreshold: this.context.clearanceThreshold,
      minimumTraceWidth: this.context.minimumTraceWidth,
    })

    // Group all assigned points by capacityMeshNodeId and connectionName so
    // we can later adjust them together per (node, connection) cluster.
    this.clusterMap = new Map()

    for (const segment of this.segmentList) {
      if (!segment.assignedPoints || segment.assignedPoints.length === 0) {
        continue
      }

      const capacityMeshNodeId = segment.capacityMeshNodeId
      if (!this.clusterMap.has(capacityMeshNodeId)) {
        this.clusterMap.set(capacityMeshNodeId, new Map())
      }
      const connectionMap = this.clusterMap.get(capacityMeshNodeId)!

      for (
        let pointIndex = 0;
        pointIndex < segment.assignedPoints.length;
        pointIndex++
      ) {
        const assignedPoint = segment.assignedPoints[pointIndex]
        const connectionName = assignedPoint.connectionName

        if (!connectionMap.has(connectionName)) {
          connectionMap.set(connectionName, [])
        }

        connectionMap.get(connectionName)!.push({ segment, pointIndex })
      }
    }
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
    console.log("[CapacitySegmentPointClearanceSolver] _step start", {
      clusterNodeCount: this.clusterMap.size,
    })

    // For each (node, connection) cluster, compute a shared inward shift
    // that brings all of its points to at least the target clearance.
    for (const [
      capacityMeshNodeId,
      connectionMap,
    ] of this.clusterMap.entries()) {
      console.log("[CapacitySegmentPointClearanceSolver] processing node", {
        capacityMeshNodeId,
        connectionCount: connectionMap.size,
      })
      const capacityMeshNode = this.capacityMeshNodeById.get(capacityMeshNodeId)
      if (!capacityMeshNode) continue

      const obstacleListForNode =
        this.capacityMeshNodeIdToObstacleList.get(capacityMeshNodeId) ?? []
      if (obstacleListForNode.length === 0) continue

      for (const [connectionName, clusterEntries] of connectionMap.entries()) {
        if (clusterEntries.length === 0) continue

        // Compute cluster centroid from the current point positions.
        let centroidX = 0
        let centroidY = 0
        for (const { segment, pointIndex } of clusterEntries) {
          const point = segment.assignedPoints![pointIndex].point
          centroidX += point.x
          centroidY += point.y
        }
        centroidX /= clusterEntries.length
        centroidY /= clusterEntries.length

        // Unit vector pointing from cluster centroid toward the node center.
        const clusterInwardUnit = getUnitVectorFromPointAToB(
          { x: centroidX, y: centroidY },
          { x: capacityMeshNode.center.x, y: capacityMeshNode.center.y },
        )

        // Determine how far we need to move this whole cluster inward.
        const clearanceThreshold = this.context.clearanceThreshold
        let requiredShiftDistance = 0

        for (const { segment, pointIndex } of clusterEntries) {
          const point = segment.assignedPoints![pointIndex].point

          // Measure distance to the closest obstacle assigned to this node.
          let closestDistance = Infinity
          for (const obstacle of obstacleListForNode) {
            const obstacleBox = {
              center: { x: obstacle.center.x, y: obstacle.center.y },
              width: obstacle.width,
              height: obstacle.height,
            }
            const distanceToObstacle = pointToBoxDistance(
              { x: point.x, y: point.y },
              obstacleBox,
            )
            if (distanceToObstacle < closestDistance) {
              closestDistance = distanceToObstacle
            }
          }

          if (!Number.isFinite(closestDistance)) continue

          const pointShiftNeeded = Math.max(
            0,
            clearanceThreshold - closestDistance,
          )
          if (pointShiftNeeded > requiredShiftDistance) {
            requiredShiftDistance = pointShiftNeeded
          }
        }

        if (requiredShiftDistance <= 0) continue

        // Apply the same inward shift to every point in this cluster so
        // their relative positions stay consistent.
        for (const { segment, pointIndex } of clusterEntries) {
          const point = segment.assignedPoints![pointIndex].point
          segment.assignedPoints![pointIndex].point = {
            x: point.x + clusterInwardUnit.x * requiredShiftDistance,
            y: point.y + clusterInwardUnit.y * requiredShiftDistance,
            z: point.z,
          }
        }
      }
    }

    this.solved = true
  }

  visualize(): GraphicsObject {
    // TODO: Return a visualization that highlights clusters of points around
    // obstacles and any adjusted positions once the optimization is implemented.
    return {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }
  }
}
