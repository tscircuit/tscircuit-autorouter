import { BaseSolver } from "../BaseSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
} from "../../types"
import type { GraphicsObject } from "graphics-debug"
import { getNodeEdgeMap } from "../CapacityMeshSolver/getNodeEdgeMap"

export interface SegmentPortPoint {
  segmentPortPointId: string
  x: number
  y: number
  availableZ: number[]
  nodeIds: [CapacityMeshNodeId, CapacityMeshNodeId]
  edgeId: string
  /** The connection name currently using this port point, or null if unused */
  connectionName: string | null
  rootConnectionName?: string
  /** XY distance to the centermost port on this Z level (centermost port has distance 0) */
  distToCentermostPortOnZ: number
}

export interface SharedEdgeSegment {
  edgeId: string
  nodeIds: [CapacityMeshNodeId, CapacityMeshNodeId]
  start: { x: number; y: number }
  end: { x: number; y: number }
  availableZ: number[]
  portPoints: SegmentPortPoint[]
}

/**
 * AvailableSegmentPointSolver computes port points on shared edges between
 * capacity mesh nodes. These points can be used for routing traces through
 * the capacity mesh.
 *
 * For each edge shared between two nodes:
 * 1. Computes the shared edge segment
 * 2. Determines how many port points can fit based on traceWidth
 * 3. Creates port points evenly spaced along the segment
 *
 * Port points start as unused (connectionName = null) and are assigned
 * as paths are routed through them.
 */
export class AvailableSegmentPointSolver extends BaseSolver {
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
  traceWidth: number
  obstacleMargin: number
  minPortSpacing: number

  nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode>
  nodeEdgeMap: Map<CapacityMeshNodeId, CapacityMeshEdge[]>

  /** All shared edge segments with their port points */
  sharedEdgeSegments: SharedEdgeSegment[] = []

  /** Map from edgeId to SharedEdgeSegment for quick lookup */
  edgeSegmentMap: Map<string, SharedEdgeSegment> = new Map()

  /** Map from segmentPortPointId to SegmentPortPoint */
  portPointMap: Map<string, SegmentPortPoint> = new Map()

  colorMap: Record<string, string>

  // edgeMargin = 0.25

  constructor({
    nodes,
    edges,
    traceWidth,
    obstacleMargin,
    colorMap,
  }: {
    nodes: CapacityMeshNode[]
    edges: CapacityMeshEdge[]
    traceWidth: number
    obstacleMargin?: number
    colorMap?: Record<string, string>
  }) {
    super()
    this.nodes = nodes
    this.edges = edges
    this.traceWidth = traceWidth
    this.obstacleMargin = obstacleMargin ?? 0.15
    // Port spacing: each trace extends traceWidth/2 from center, plus obstacleMargin clearance
    // Center-to-center distance = traceWidth + obstacleMargin
    this.minPortSpacing = this.traceWidth + this.obstacleMargin
    this.colorMap = colorMap ?? {}

    this.nodeMap = new Map(nodes.map((node) => [node.capacityMeshNodeId, node]))
    this.nodeEdgeMap = getNodeEdgeMap(edges)

    // This solver completes in a single step
    this.MAX_ITERATIONS = 1
  }

  _step() {
    this.computeAllSharedEdgeSegments()
    this.solved = true
  }

  private computeAllSharedEdgeSegments() {
    for (const edge of this.edges) {
      const [nodeId1, nodeId2] = edge.nodeIds
      const node1 = this.nodeMap.get(nodeId1)
      const node2 = this.nodeMap.get(nodeId2)

      if (!node1 || !node2) continue

      const segment = this.computeSharedEdgeSegment(edge, node1, node2)
      if (segment) {
        this.sharedEdgeSegments.push(segment)
        this.edgeSegmentMap.set(edge.capacityMeshEdgeId, segment)

        for (const portPoint of segment.portPoints) {
          this.portPointMap.set(portPoint.segmentPortPointId, portPoint)
        }
      }
    }
  }

  private computeSharedEdgeSegment(
    edge: CapacityMeshEdge,
    node1: CapacityMeshNode,
    node2: CapacityMeshNode,
  ): SharedEdgeSegment | null {
    const overlap = this.findOverlappingSegment(node1, node2)
    if (!overlap) return null

    // Compute mutually available Z layers
    const availableZ = node1.availableZ.filter((z) =>
      node2.availableZ.includes(z),
    )
    if (availableZ.length === 0) return null

    // Compute how many port points can fit on this segment
    const segmentLength = Math.sqrt(
      (overlap.end.x - overlap.start.x) ** 2 +
        (overlap.end.y - overlap.start.y) ** 2,
    )

    // Apply edge margin to avoid placing points too close to corners
    // The margin is half the port spacing to ensure points are at least that far from edges
    const edgeMargin = (this.minPortSpacing * 3) / 4 // this.edgeMargin + segmentLength * 0.1
    const effectiveLength = Math.max(0, segmentLength - edgeMargin * 2)

    if (
      effectiveLength <= 0 &&
      !node1._containsTarget &&
      !node2._containsTarget
    ) {
      return null
    }

    // At minimum we need 1 port point, at maximum we space them minPortSpacing apart
    let maxPortPoints = Math.max(
      1,
      Math.floor(effectiveLength / this.minPortSpacing) + 1,
    )

    if (node1._offBoardConnectionId || node2._offBoardConnectionId) {
      maxPortPoints = 1
    }

    // Create port points evenly spaced along the segment
    // Each port point is created for a single layer (not multiple layers)
    const portPoints: SegmentPortPoint[] = []
    const dx = overlap.end.x - overlap.start.x
    const dy = overlap.end.y - overlap.start.y

    // Center of the segment
    const centerX = (overlap.start.x + overlap.end.x) / 2
    const centerY = (overlap.start.y + overlap.end.y) / 2

    if (maxPortPoints > 5) {
      maxPortPoints = 5 + maxPortPoints / 4
    }

    // First pass: compute all XY positions and find which is closest to segment center
    const xyPositions: Array<{ x: number; y: number; distToCenter: number }> =
      []
    for (let i = 0; i < maxPortPoints; i++) {
      let fraction: number
      if (segmentLength === 0) {
        fraction = 0.5
      } else if (maxPortPoints === 1) {
        fraction = 0.5
      } else {
        fraction =
          (edgeMargin + (effectiveLength * i) / (maxPortPoints - 1)) /
          segmentLength
      }
      const x = overlap.start.x + dx * fraction
      const y = overlap.start.y + dy * fraction
      const distToCenter = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2)
      xyPositions.push({ x, y, distToCenter })
    }

    // Find the centermost port position (smallest distance to segment center)
    const centermostPos = xyPositions.reduce((best, pos) =>
      pos.distToCenter < best.distToCenter ? pos : best,
    )

    // Second pass: create port points with distance to centermost port
    for (let i = 0; i < maxPortPoints; i++) {
      const { x, y } = xyPositions[i]

      // Calculate XY distance to the centermost port position
      const distToCentermostPortOnZ = Math.sqrt(
        (x - centermostPos.x) ** 2 + (y - centermostPos.y) ** 2,
      )

      // Create a separate port point for each available layer
      for (const z of availableZ) {
        const portPoint: SegmentPortPoint = {
          segmentPortPointId: `${edge.capacityMeshEdgeId}_pp${i}_z${z}`,
          x,
          y,
          availableZ: [z],
          nodeIds: [node1.capacityMeshNodeId, node2.capacityMeshNodeId],
          edgeId: edge.capacityMeshEdgeId,
          connectionName: null,
          distToCentermostPortOnZ,
        }
        portPoints.push(portPoint)
      }
    }

    return {
      edgeId: edge.capacityMeshEdgeId,
      nodeIds: [node1.capacityMeshNodeId, node2.capacityMeshNodeId],
      start: overlap.start,
      end: overlap.end,
      availableZ,
      portPoints,
    }
  }

  private findOverlappingSegment(
    node: CapacityMeshNode,
    adjNode: CapacityMeshNode,
  ): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
    // Find overlapping ranges in x and y dimensions
    const xOverlap = {
      start: Math.max(
        node.center.x - node.width / 2,
        adjNode.center.x - adjNode.width / 2,
      ),
      end: Math.min(
        node.center.x + node.width / 2,
        adjNode.center.x + adjNode.width / 2,
      ),
    }

    const yOverlap = {
      start: Math.max(
        node.center.y - node.height / 2,
        adjNode.center.y - adjNode.height / 2,
      ),
      end: Math.min(
        node.center.y + node.height / 2,
        adjNode.center.y + adjNode.height / 2,
      ),
    }

    const xRange = xOverlap.end - xOverlap.start
    const yRange = yOverlap.end - yOverlap.start

    // If there's no overlap, return null
    // Use small epsilon to handle floating-point precision issues at node boundaries
    const epsilon = 0.0001
    if (xRange < -epsilon || yRange < -epsilon) return null

    // If the x-range is smaller then the nodes touch vertically (common vertical edge).
    if (xRange < yRange) {
      // They are horizontally adjacent: shared vertical edge.
      const x = (xOverlap.start + xOverlap.end) / 2
      return {
        start: { x, y: yOverlap.start },
        end: { x, y: yOverlap.end },
      }
    } else {
      // Otherwise, they are vertically adjacent: shared horizontal edge.
      const y = (yOverlap.start + yOverlap.end) / 2
      return {
        start: { x: xOverlap.start, y },
        end: { x: xOverlap.end, y },
      }
    }
  }

  /**
   * Find available port points for traveling between two nodes
   */
  getAvailablePortPointsBetweenNodes(
    nodeId1: CapacityMeshNodeId,
    nodeId2: CapacityMeshNodeId,
  ): SegmentPortPoint[] {
    // Find the edge connecting these nodes
    const edge = this.edges.find(
      (e) =>
        (e.nodeIds[0] === nodeId1 && e.nodeIds[1] === nodeId2) ||
        (e.nodeIds[0] === nodeId2 && e.nodeIds[1] === nodeId1),
    )
    if (!edge) return []

    const segment = this.edgeSegmentMap.get(edge.capacityMeshEdgeId)
    if (!segment) return []

    // Return port points that are not currently assigned
    return segment.portPoints.filter((pp) => pp.connectionName === null)
  }

  /**
   * Get all port points (both assigned and unassigned) for an edge between nodes
   */
  getPortPointsForEdge(
    nodeId1: CapacityMeshNodeId,
    nodeId2: CapacityMeshNodeId,
  ): SegmentPortPoint[] {
    const edge = this.edges.find(
      (e) =>
        (e.nodeIds[0] === nodeId1 && e.nodeIds[1] === nodeId2) ||
        (e.nodeIds[0] === nodeId2 && e.nodeIds[1] === nodeId1),
    )
    if (!edge) return []

    const segment = this.edgeSegmentMap.get(edge.capacityMeshEdgeId)
    return segment?.portPoints ?? []
  }

  /**
   * Assign a port point to a connection
   */
  assignPortPoint(
    segmentPortPointId: string,
    connectionName: string,
    rootConnectionName?: string,
  ): boolean {
    const portPoint = this.portPointMap.get(segmentPortPointId)
    if (!portPoint) return false
    if (portPoint.connectionName !== null) return false // Already assigned

    portPoint.connectionName = connectionName
    portPoint.rootConnectionName = rootConnectionName
    return true
  }

  /**
   * Release a port point (make it available again)
   */
  releasePortPoint(segmentPortPointId: string): boolean {
    const portPoint = this.portPointMap.get(segmentPortPointId)
    if (!portPoint) return false

    portPoint.connectionName = null
    portPoint.rootConnectionName = undefined
    return true
  }

  /**
   * Get the count of available port points on an edge
   */
  getAvailablePortCountForEdge(
    nodeId1: CapacityMeshNodeId,
    nodeId2: CapacityMeshNodeId,
  ): number {
    return this.getAvailablePortPointsBetweenNodes(nodeId1, nodeId2).length
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Draw shared edge segments
    for (const segment of this.sharedEdgeSegments) {
      graphics.lines!.push({
        points: [segment.start, segment.end],
        strokeColor: "rgba(100, 100, 100, 0.5)",
      })

      // Draw port points
      for (const portPoint of segment.portPoints) {
        const color = portPoint.connectionName
          ? (this.colorMap[portPoint.connectionName] ?? "blue")
          : "rgba(0, 200, 0, 0.7)"

        graphics.circles!.push({
          center: { x: portPoint.x, y: portPoint.y },
          radius: this.traceWidth / 2,
          fill: color,
          layer: `z${portPoint.availableZ.join(",")}`,
          label: [
            portPoint.segmentPortPointId,
            portPoint.connectionName,
            portPoint.availableZ.join(","),
            `cd: ${portPoint.distToCentermostPortOnZ}`,
            `connects: ${portPoint.nodeIds.join(",")}`,
          ]
            .filter(Boolean)
            .join("\n"),
        })
      }
    }

    return graphics
  }
}
