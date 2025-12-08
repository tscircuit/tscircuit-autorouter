import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { CapacityMeshNode, CapacityMeshNodeId, Obstacle } from "lib/types"
import type { SegmentWithAssignedPoints } from "lib/solvers/CapacityMeshSolver/CapacitySegmentToPointSolver"
import { pointToBoxDistance } from "@tscircuit/math-utils"
import {
  collectNearbyObstaclesForCapacityNodes,
  isAxisAlignedSegmentCluster,
} from "lib/solvers/CapacityMeshSolver/subsolvers/capacitySegmentPointClearanceHelpers"

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

const SEGMENT_POINT_CLEARANCE_COLORS = {
  node: "#3e4fe68a",
  obstacle: "#cf3333ff",
  segment: "#cac82fff",
  point: "#000000ff",
  beforeAfterLine: "#5f5f5fff",
} as const

export class CapacitySegmentPointClearanceSolver extends BaseSolver {
  segmentList: SegmentWithAssignedPoints[]
  context: SegmentPointClearanceContext
  capacityMeshNodeIdWithNearbyObstacleList: CapacityMeshNodeId[]
  capacityMeshNodeById: Map<CapacityMeshNodeId, CapacityMeshNode>
  capacityMeshNodeIdToObstacleList!: Map<CapacityMeshNodeId, Obstacle[]>
  clusterMap!: NodeClusterMap
  clusterOrder: Array<{
    capacityMeshNodeId: CapacityMeshNodeId
    connectionName: ConnectionName
  }> = []
  currentClusterIndex = 0
  activeClusterIndex: number | null = null
  lastClusterSnapshot: {
    capacityMeshNodeId: CapacityMeshNodeId
    connectionName: ConnectionName
    oldPoints: { x: number; y: number }[]
    newPoints: { x: number; y: number }[]
  } | null = null
  visualizationPhase: "before" | "after" | null = null

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
    const { capacityMeshNodeIdList, capacityMeshNodeIdToObstacleList } =
      collectNearbyObstaclesForCapacityNodes({
        capacityMeshNodeList: this.context.capacityMeshNodeList,
        obstacleList: this.context.obstacleList,
        clearanceThreshold: this.context.clearanceThreshold,
      })

    this.capacityMeshNodeIdToObstacleList = capacityMeshNodeIdToObstacleList

    return capacityMeshNodeIdList
  }

  _step() {
    // Initialize cluster processing order lazily.
    if (this.clusterOrder.length === 0) {
      for (const [capacityMeshNodeId, connectionMap] of this.clusterMap) {
        for (const connectionName of connectionMap.keys()) {
          this.clusterOrder.push({ capacityMeshNodeId, connectionName })
        }
      }
    }

    if (this.currentClusterIndex >= this.clusterOrder.length) {
      this.solved = true
      return
    }

    const { capacityMeshNodeId, connectionName } =
      this.clusterOrder[this.currentClusterIndex]
    this.activeClusterIndex = this.currentClusterIndex
    this.currentClusterIndex += 1
    this.visualizationPhase = "before"

    const connectionMap = this.clusterMap.get(capacityMeshNodeId)
    if (!connectionMap) {
      return
    }

    const clusterEntries = connectionMap.get(connectionName) ?? []
    if (clusterEntries.length === 0) {
      return
    }

    // Only adjust clusters that are axis-aligned (all same x or all same y).
    if (!isAxisAlignedSegmentCluster({ clusterEntries })) {
      return
    }

    const capacityMeshNode = this.capacityMeshNodeById.get(capacityMeshNodeId)
    if (!capacityMeshNode) {
      return
    }

    const obstacleListForNode =
      this.capacityMeshNodeIdToObstacleList.get(capacityMeshNodeId) ?? []
    if (obstacleListForNode.length === 0) {
      return
    }

    // Compute cluster centroid from the current point positions.
    let centroidX = 0
    let centroidY = 0
    const oldPoints: { x: number; y: number }[] = []
    for (const { segment, pointIndex } of clusterEntries) {
      const point = segment.assignedPoints![pointIndex].point
      centroidX += point.x
      centroidY += point.y
      oldPoints.push({ x: point.x, y: point.y })
    }
    centroidX /= clusterEntries.length
    centroidY /= clusterEntries.length

    // Unit vector pointing from cluster centroid toward the node center.
    const dirX = capacityMeshNode.center.x - centroidX
    const dirY = capacityMeshNode.center.y - centroidY
    const dirLength = Math.hypot(dirX, dirY)
    if (!Number.isFinite(dirLength) || dirLength <= 0) {
      // Degenerate direction (zero-length or invalid); skip shifting to
      // avoid introducing NaN coordinates.
      return
    }
    const clusterInwardUnit = {
      x: dirX / dirLength,
      y: dirY / dirLength,
    }

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

      if (!Number.isFinite(closestDistance)) {
        continue
      }

      const pointShiftNeeded = Math.max(0, clearanceThreshold - closestDistance)
      if (pointShiftNeeded > requiredShiftDistance) {
        requiredShiftDistance = pointShiftNeeded
      }
    }

    if (requiredShiftDistance <= 0) {
      return
    }

    // Apply the same inward shift to every point in this cluster so
    // their relative positions stay consistent.
    const newPoints: { x: number; y: number }[] = []

    for (const { segment, pointIndex } of clusterEntries) {
      const point = segment.assignedPoints![pointIndex].point
      const shiftedPoint = {
        x: point.x + clusterInwardUnit.x * requiredShiftDistance,
        y: point.y + clusterInwardUnit.y * requiredShiftDistance,
        z: point.z,
      }
      segment.assignedPoints![pointIndex].point = shiftedPoint
      newPoints.push({ x: shiftedPoint.x, y: shiftedPoint.y })
    }

    this.lastClusterSnapshot = {
      capacityMeshNodeId,
      connectionName,
      oldPoints,
      newPoints,
    }
    this.visualizationPhase = "after"
  }

  private isAxisAlignedCluster(
    clusterEntries: ConnectionClusterEntry[],
  ): boolean {
    if (clusterEntries.length < 2) return false

    const epsilon = 1e-6
    const firstPoint =
      clusterEntries[0].segment.assignedPoints![clusterEntries[0].pointIndex]
        .point

    let allSameX = true
    let allSameY = true

    for (const { segment, pointIndex } of clusterEntries) {
      const p = segment.assignedPoints![pointIndex].point
      if (Math.abs(p.x - firstPoint.x) > epsilon) allSameX = false
      if (Math.abs(p.y - firstPoint.y) > epsilon) allSameY = false
      if (!allSameX && !allSameY) {
        return false
      }
    }

    return allSameX || allSameY
  }

  visualize(): GraphicsObject {
    if (
      this.activeClusterIndex === null ||
      this.clusterOrder.length === 0 ||
      this.activeClusterIndex >= this.clusterOrder.length
    ) {
      return {
        lines: [],
        points: [],
        rects: [],
        circles: [],
      }
    }

    const activeCluster = this.clusterOrder[this.activeClusterIndex]

    const connectionMap = this.clusterMap.get(activeCluster.capacityMeshNodeId)
    if (!connectionMap) {
      return {
        lines: [],
        points: [],
        rects: [],
        circles: [],
      }
    }

    const clusterEntries = connectionMap.get(activeCluster.connectionName) ?? []
    if (clusterEntries.length === 0) {
      return {
        lines: [],
        points: [],
        rects: [],
        circles: [],
      }
    }

    const lines: NonNullable<GraphicsObject["lines"]> = []
    const points: NonNullable<GraphicsObject["points"]> = []
    const rects: NonNullable<GraphicsObject["rects"]> = []

    const capacityMeshNode = this.capacityMeshNodeById.get(
      activeCluster.capacityMeshNodeId,
    )
    if (capacityMeshNode) {
      rects.push({
        center: { x: capacityMeshNode.center.x, y: capacityMeshNode.center.y },
        width: capacityMeshNode.width,
        height: capacityMeshNode.height,
        color: SEGMENT_POINT_CLEARANCE_COLORS.node,
        fill: SEGMENT_POINT_CLEARANCE_COLORS.node,
      })
    }

    const obstacleListForNode =
      this.capacityMeshNodeIdToObstacleList.get(
        activeCluster.capacityMeshNodeId,
      ) ?? []
    for (const obstacle of obstacleListForNode) {
      rects.push({
        center: { x: obstacle.center.x, y: obstacle.center.y },
        width: obstacle.width,
        height: obstacle.height,
        color: SEGMENT_POINT_CLEARANCE_COLORS.obstacle,
        fill: SEGMENT_POINT_CLEARANCE_COLORS.obstacle,
      })
    }

    const seenSegmentIds = new Set<string>()

    for (const { segment } of clusterEntries) {
      const segmentId = String(segment.nodePortSegmentId ?? "")
      if (segmentId && !seenSegmentIds.has(segmentId)) {
        seenSegmentIds.add(segmentId)
        lines.push({
          points: [segment.start, segment.end],
          step: 4,
          strokeColor: SEGMENT_POINT_CLEARANCE_COLORS.segment,
        })
      }
    }

    // If we have a snapshot for the last processed cluster and are in the
    // "after" phase, draw before/after points.
    if (
      this.visualizationPhase === "after" &&
      this.lastClusterSnapshot &&
      this.lastClusterSnapshot.capacityMeshNodeId ===
        activeCluster.capacityMeshNodeId &&
      this.lastClusterSnapshot.connectionName === activeCluster.connectionName
    ) {
      const { oldPoints, newPoints } = this.lastClusterSnapshot
      for (let i = 0; i < oldPoints.length; i++) {
        const oldPoint = oldPoints[i]
        const newPoint = newPoints[i]
        points.push({
          x: oldPoint.x,
          y: oldPoint.y,
          color: SEGMENT_POINT_CLEARANCE_COLORS.point,
        })
        points.push({
          x: newPoint.x,
          y: newPoint.y,
          color: SEGMENT_POINT_CLEARANCE_COLORS.point,
        })
        lines.push({
          points: [
            { x: oldPoint.x, y: oldPoint.y },
            { x: newPoint.x, y: newPoint.y },
          ],
          step: 4,
          strokeDash: "5 5",
          strokeColor: SEGMENT_POINT_CLEARANCE_COLORS.beforeAfterLine,
        })
      }
    } else {
      // Otherwise just draw current points using the connection color.
      for (const { segment, pointIndex } of clusterEntries) {
        const p = segment.assignedPoints![pointIndex].point
        points.push({
          x: p.x,
          y: p.y,
          color: SEGMENT_POINT_CLEARANCE_COLORS.point,
        })
      }
    }

    return {
      lines,
      points,
      rects,
      circles: [],
    }
  }
}
