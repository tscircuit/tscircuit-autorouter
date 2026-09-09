import { BaseSolver } from "../BaseSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
} from "../../types"
import type { GraphicsObject } from "graphics-debug"
import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"
import { RbushIndex } from "lib/data-structures/RbushIndex"
import { getNodeEdgeMap } from "../CapacityMeshSolver/getNodeEdgeMap"
import type {
  PhysicalNodeCut,
  PhysicalNodeCutContext,
} from "../NodeDimensionSubdivisionSolver/physicalNodeCuts"
import { getFixedCopperPortalSites } from "../UniformPortDistributionSolver/getFixedCopperPortalSites"
import { getPhysicalCutIdOrThrow } from "./getPhysicalCutIdOrThrow"
import {
  getNetAwareCrampedPortSites,
  type NetAwareCrampedPortSitesInput,
} from "./getNetAwareCrampedPortSites"

type PhysicalNodeCutInput = {
  readonly context: PhysicalNodeCutContext
  readonly cuts: readonly PhysicalNodeCut[]
}

/** Complete immutable board geometry; edge subsets are prepared internally. */
export type PhysicalCrampedPortContext = Omit<
  NetAwareCrampedPortSitesInput,
  "start" | "end" | "existingPoint"
>

export interface PreloadedTracePortAssignment {
  traceId: string
  fixedNetId: string
  routePosition: number
  tracePoint: { x: number; y: number }
  z: number
}

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
  /**
   * This is special port point that is created in narrow gaps, and only kept when otherwise reaching the obstacle is impossible
   * ideally this port points should be discarded but we need them in some cases
   */
  cramped: boolean
  /** Finite physical-cut resource whose original sites must not be duplicated. */
  physicalCutId?: string
  /** Extra tiny-hypergraph traversal cost for fallback ports. */
  tinyHypergraphPortPenalty?: number
  /** Canonical fixed-net ids loaded onto this existing graph port. */
  _preloadedFixedNetIds?: string[]
  /** Ordered crossings used to create serialized graph assignments. */
  _preloadedTracePortAssignments?: PreloadedTracePortAssignment[]
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
  override getSolverName(): string {
    return "AvailableSegmentPointSolver"
  }

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
  shouldReturnCrampedPortPoints: boolean
  private readonly physicalNodeCuts: PhysicalNodeCutInput | undefined
  private readonly physicalCutByNodePair = new Map<
    string,
    Map<string, PhysicalNodeCut>
  >()
  private readonly consumedPhysicalCutIds = new Set<string>()
  private readonly physicalCrampedPortContext?: PhysicalCrampedPortContext
  private readonly crampedRectangleIndexes = new Map<
    number,
    RbushIndex<FixedCopperRectangle>
  >()

  // edgeMargin = 0.25

  constructor({
    nodes,
    edges,
    traceWidth,
    obstacleMargin,
    colorMap,
    shouldReturnCrampedPortPoints,
    physicalNodeCuts,
    physicalCrampedPortContext,
  }: {
    nodes: CapacityMeshNode[]
    edges: CapacityMeshEdge[]
    traceWidth: number
    obstacleMargin?: number
    colorMap?: Record<string, string>
    shouldReturnCrampedPortPoints: boolean
    physicalNodeCuts?: PhysicalNodeCutInput
    physicalCrampedPortContext?: PhysicalCrampedPortContext
  }) {
    super()
    this.nodes = nodes
    this.edges = edges
    this.traceWidth = traceWidth
    this.obstacleMargin = obstacleMargin ?? 0.15
    this.shouldReturnCrampedPortPoints = shouldReturnCrampedPortPoints
    // Port spacing: each trace extends traceWidth/2 from center, plus obstacleMargin clearance
    // Center-to-center distance = traceWidth + obstacleMargin
    this.minPortSpacing = this.traceWidth + this.obstacleMargin
    this.colorMap = colorMap ?? {}

    this.nodeMap = new Map(nodes.map((node) => [node.capacityMeshNodeId, node]))
    this.nodeEdgeMap = getNodeEdgeMap(edges)
    this.physicalNodeCuts = physicalNodeCuts
    this.indexPhysicalNodeCuts()
    if (physicalCrampedPortContext !== undefined) {
      this.physicalCrampedPortContext = this.preparePhysicalCrampedPortContext(
        physicalCrampedPortContext,
      )
    }

    // This solver completes in a single step
    this.MAX_ITERATIONS = 1
  }

  _step() {
    this.computeAllSharedEdgeSegments()
    this.solved = true
  }

  private preparePhysicalCrampedPortContext(
    context: PhysicalCrampedPortContext,
  ): PhysicalCrampedPortContext {
    if (
      context.traceWidth !== this.traceWidth ||
      !Number.isFinite(context.traceWidth) ||
      context.traceWidth / 2 <= 0 ||
      !Number.isFinite(context.traceGap) ||
      context.traceGap < 0 ||
      !Number.isFinite(context.traceWidth + context.traceGap) ||
      context.routableNetIds.size === 0 ||
      !(context.clearanceIndex instanceof FixedCopperClearanceIndex)
    ) {
      throw new Error(
        "AvailableSegmentPointSolver requires a common physical cramped-port width and context",
      )
    }
    const routableNetIds = new Set(context.routableNetIds)
    for (const netId of routableNetIds) {
      if (typeof netId !== "string" || netId.length === 0) {
        throw new Error(
          "AvailableSegmentPointSolver requires canonical cramped-port nets",
        )
      }
    }
    const rectangles = context.rectangles.map(
      (rectangle): FixedCopperRectangle => ({
        ...rectangle,
        center: { ...rectangle.center },
        zLayers: [...rectangle.zLayers],
        ownerNetIds: new Set(rectangle.ownerNetIds),
      }),
    )
    // Validate the complete source once, including distant and owned copper.
    // The public fingerprint verifies that the supplied whole-board predicate
    // uses these exact rectangles, layers and pad-clearance rules.
    const validationIndex = new FixedCopperClearanceIndex({
      rectangles,
      layerCount: context.layerCount,
      minClearance: context.padGap,
    })
    if (
      validationIndex.cacheFingerprint !==
      context.clearanceIndex.cacheFingerprint
    ) {
      throw new Error(
        "AvailableSegmentPointSolver cramped-port geometry must match its whole-board index",
      )
    }
    for (const rectangle of rectangles) {
      const angle =
        (((rectangle.ccwRotationDegrees ?? 0) % 360) * Math.PI) / 180
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const halfWidth =
        Math.abs(cos) * (rectangle.width / 2) +
        Math.abs(sin) * (rectangle.height / 2)
      const halfHeight =
        Math.abs(sin) * (rectangle.width / 2) +
        Math.abs(cos) * (rectangle.height / 2)
      for (const z of new Set(rectangle.zLayers)) {
        let index = this.crampedRectangleIndexes.get(z)
        if (index === undefined) {
          index = new RbushIndex<FixedCopperRectangle>()
          this.crampedRectangleIndexes.set(z, index)
        }
        // Identical public-geometry AABBs to FixedCopperClearanceIndex. Every
        // point query on the edge has bounds contained in its expanded edge
        // query, so omitted rectangles cannot affect any emitted point there.
        index.insert(
          rectangle,
          rectangle.center.x - halfWidth,
          rectangle.center.y - halfHeight,
          rectangle.center.x + halfWidth,
          rectangle.center.y + halfHeight,
        )
      }
    }
    return { ...context, rectangles, routableNetIds }
  }

  private getPhysicalCrampedPortPoints(
    edge: CapacityMeshEdge,
    overlap: { start: { x: number; y: number }; end: { x: number; y: number } },
    existingPort: SegmentPortPoint,
    z: number,
  ): SegmentPortPoint[] {
    const context = this.physicalCrampedPortContext
    if (context === undefined) {
      throw new Error("Physical cramped ports require their source context")
    }
    const point = { x: existingPort.x, y: existingPort.y, z }
    const allowed = context.clearanceIndex.getAllowedNetIdsAtPoint({
      point,
      copperDiameter: context.traceWidth,
    })
    if (
      allowed === null ||
      [...allowed].some((netId): boolean => context.routableNetIds.has(netId))
    ) {
      return [existingPort]
    }
    const margin = context.traceWidth / 2 + context.padGap
    const minX = Math.min(overlap.start.x, overlap.end.x) - margin
    const minY = Math.min(overlap.start.y, overlap.end.y) - margin
    const maxX = Math.max(overlap.start.x, overlap.end.x) + margin
    const maxY = Math.max(overlap.start.y, overlap.end.y) + margin
    if (
      ![minX, minY, maxX, maxY].every((value): boolean =>
        Number.isFinite(value),
      )
    ) {
      throw new Error(
        `Physical cramped edge "${edge.capacityMeshEdgeId}" layer ${z} has nonfinite query bounds`,
      )
    }
    const index = this.crampedRectangleIndexes.get(z)
    const rectangles =
      index === undefined ? [] : index.search(minX, minY, maxX, maxY)
    const result = getNetAwareCrampedPortSites({
      ...context,
      rectangles,
      start: overlap.start,
      end: overlap.end,
      existingPoint: point,
    })
    if (result.status !== "complete") {
      throw new Error(
        `Physical cramped edge "${edge.capacityMeshEdgeId}" layer ${z} is unresolved: ${JSON.stringify(result)}`,
      )
    }
    if (result.sites.length === 0) return []
    const axis = result.axis
    let centermostSite = result.sites[0]!
    for (const site of result.sites) {
      if (
        Math.abs(site[axis] - point[axis]) <
        Math.abs(centermostSite[axis] - point[axis])
      ) {
        centermostSite = site
      }
    }
    return result.sites.map(
      (site): SegmentPortPoint => ({
        ...existingPort,
        segmentPortPointId: `${edge.capacityMeshEdgeId}_pp${site.index}_z${z}_cramped`,
        x: site.x,
        y: site.y,
        distToCentermostPortOnZ: Math.abs(site[axis] - centermostSite[axis]),
      }),
    )
  }

  private indexPhysicalNodeCuts(): void {
    if (this.physicalNodeCuts === undefined) return
    if (this.physicalNodeCuts.context.traceWidth !== this.traceWidth) {
      throw new Error("Physical node cuts must use the shared-edge trace width")
    }
    const cutIds = new Set<string>()
    for (const cut of this.physicalNodeCuts.cuts) {
      const physicalCutId = getPhysicalCutIdOrThrow(
        cut.physicalCutId,
        "physical node cut",
      )
      if (physicalCutId === undefined || cutIds.has(physicalCutId)) {
        throw new Error("Physical node cuts require distinct resource IDs")
      }
      const [firstId, secondId] = cut.nodeIds
      if (
        firstId === secondId ||
        !this.nodeMap.has(firstId) ||
        !this.nodeMap.has(secondId)
      ) {
        throw new Error(
          `Physical node cut "${physicalCutId}" has invalid nodes`,
        )
      }
      cutIds.add(physicalCutId)
      for (const [fromId, toId] of [
        [firstId, secondId],
        [secondId, firstId],
      ] as const) {
        let neighbors = this.physicalCutByNodePair.get(fromId)
        if (neighbors === undefined) {
          neighbors = new Map<string, PhysicalNodeCut>()
          this.physicalCutByNodePair.set(fromId, neighbors)
        }
        if (neighbors.has(toId)) {
          throw new Error("Physical node cuts cannot repeat a shared node pair")
        }
        neighbors.set(toId, cut)
      }
    }
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
    if (this.physicalNodeCuts !== undefined) {
      for (const cut of this.physicalNodeCuts.cuts) {
        if (!this.consumedPhysicalCutIds.has(cut.physicalCutId)) {
          throw new Error(
            `Physical node cut "${cut.physicalCutId}" has no shared graph edge`,
          )
        }
      }
    }
  }

  private createPhysicalCutSegment(
    edge: CapacityMeshEdge,
    overlap: { start: { x: number; y: number }; end: { x: number; y: number } },
    availableZ: number[],
    cut: PhysicalNodeCut,
  ): SharedEdgeSegment {
    if (this.physicalNodeCuts === undefined) {
      throw new Error(
        "Physical cut sites require their source geometry context",
      )
    }
    if (this.consumedPhysicalCutIds.has(cut.physicalCutId)) {
      throw new Error(
        `Physical node cut "${cut.physicalCutId}" has repeated edges`,
      )
    }
    // Recompute on the actual shared edge, not its nominal subdivision plane:
    // reconstructing centers and dimensions can change a boundary by an ULP.
    const physicalSites = getFixedCopperPortalSites({
      ...this.physicalNodeCuts.context,
      start: overlap.start,
      end: overlap.end,
      zLayers: availableZ,
    })
    const portPoints: SegmentPortPoint[] = []
    const axis = physicalSites.axis
    const center = (physicalSites.start[axis] + physicalSites.end[axis]) / 2
    for (const layer of physicalSites.layers) {
      let centermostSite = layer.sites[0]
      // A blocked layer has no resource. Do not invent a cramped midpoint.
      if (centermostSite === undefined) continue
      for (const site of layer.sites) {
        if (
          Math.abs(site[axis] - center) <
          Math.abs(centermostSite[axis] - center)
        ) {
          centermostSite = site
        }
      }
      for (const site of layer.sites) {
        portPoints.push({
          segmentPortPointId: `${edge.capacityMeshEdgeId}_pp${site.index}_z${layer.z}`,
          x: site.x,
          y: site.y,
          availableZ: [layer.z],
          nodeIds: [...edge.nodeIds],
          edgeId: edge.capacityMeshEdgeId,
          connectionName: null,
          distToCentermostPortOnZ: Math.abs(site[axis] - centermostSite[axis]),
          cramped: false,
          physicalCutId: cut.physicalCutId,
        })
      }
    }
    this.consumedPhysicalCutIds.add(cut.physicalCutId)
    return {
      edgeId: edge.capacityMeshEdgeId,
      nodeIds: [...edge.nodeIds],
      start: overlap.start,
      end: overlap.end,
      availableZ,
      portPoints,
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

    const physicalCut = this.physicalCutByNodePair
      .get(node1.capacityMeshNodeId)
      ?.get(node2.capacityMeshNodeId)
    if (physicalCut !== undefined) {
      return this.createPhysicalCutSegment(
        edge,
        overlap,
        availableZ,
        physicalCut,
      )
    }

    // Compute how many port points can fit on this segment
    const segmentLength = Math.sqrt(
      (overlap.end.x - overlap.start.x) ** 2 +
        (overlap.end.y - overlap.start.y) ** 2,
    )
    const edgeTouchesNarrowQfpPadGap = Boolean(
      node1._isNarrowQfpPadGap || node2._isNarrowQfpPadGap,
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
      if (!this.shouldReturnCrampedPortPoints) {
        return null
      }
      const crampedPortPoints: SegmentPortPoint[] = []
      for (const z of availableZ) {
        const existingPort: SegmentPortPoint = {
          segmentPortPointId: `${edge.capacityMeshEdgeId}_pp0_z${z}_cramped`,
          x: (overlap.start.x + overlap.end.x) / 2,
          y: (overlap.start.y + overlap.end.y) / 2,
          availableZ: [z],
          nodeIds: [node1.capacityMeshNodeId, node2.capacityMeshNodeId],
          edgeId: edge.capacityMeshEdgeId,
          connectionName: null,
          distToCentermostPortOnZ: 0,
          cramped: true,
        }
        if (
          this.physicalCrampedPortContext !== undefined &&
          segmentLength > 0 &&
          !edge.isOffboardEdge &&
          !node1._offBoardConnectionId &&
          !node2._offBoardConnectionId &&
          !node1._isVirtualOffboard &&
          !node2._isVirtualOffboard
        ) {
          crampedPortPoints.push(
            ...this.getPhysicalCrampedPortPoints(
              edge,
              overlap,
              existingPort,
              z,
            ),
          )
        } else {
          crampedPortPoints.push(existingPort)
        }
      }
      return {
        edgeId: edge.capacityMeshEdgeId,
        nodeIds: [node1.capacityMeshNodeId, node2.capacityMeshNodeId],
        start: overlap.start,
        end: overlap.end,
        availableZ,
        portPoints: crampedPortPoints,
      }
    }
    // At minimum we need 1 port point, at maximum we space them minPortSpacing apart
    let maxPortPoints = Math.max(
      1,
      Math.floor(effectiveLength / this.minPortSpacing) + 1,
    )

    if (node1._offBoardConnectionId || node2._offBoardConnectionId) {
      // If one node has offBoardConnectionId and the other doesn't,
      // check if the other is connected to the same offBoardConnectionId via another node
      if (node1._offBoardConnectionId && !node2._offBoardConnectionId) {
        if (this.shouldSkipOffBoardPortPoint(node1, node2)) {
          return null
        }
      } else if (node2._offBoardConnectionId && !node1._offBoardConnectionId) {
        if (this.shouldSkipOffBoardPortPoint(node2, node1)) {
          return null
        }
      }
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
      maxPortPoints = 5 + Math.floor(maxPortPoints / 4)
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
          cramped: edgeTouchesNarrowQfpPadGap,
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

  /**
   * Check if we should skip creating port points between an off-board node and a middle node.
   * Returns true if the middle node is connected to another node with the same offBoardConnectionId,
   * exactly 2 nodes have that ID, and their midpoint is inside the middle node.
   */
  private shouldSkipOffBoardPortPoint(
    offBoardNode: CapacityMeshNode,
    middleNode: CapacityMeshNode,
  ): boolean {
    const middleNodeEdges =
      this.nodeEdgeMap.get(middleNode.capacityMeshNodeId) ?? []
    for (const e of middleNodeEdges) {
      const otherNodeId =
        e.nodeIds[0] === middleNode.capacityMeshNodeId
          ? e.nodeIds[1]
          : e.nodeIds[0]
      if (otherNodeId === offBoardNode.capacityMeshNodeId) continue
      const otherNode = this.nodeMap.get(otherNodeId)!
      if (
        otherNode?._offBoardConnectionId !== offBoardNode._offBoardConnectionId
      )
        continue

      // Check that exactly 2 nodes have this offBoardConnectionId
      const nodesWithSameOffBoardId = this.nodes.filter(
        (n) => n._offBoardConnectionId === offBoardNode._offBoardConnectionId,
      )
      if (nodesWithSameOffBoardId.length !== 2) continue

      // Check that the midpoint of the two off-board nodes is inside the middle node
      const midpoint = {
        x: (offBoardNode.center.x + otherNode.center.x) / 2,
        y: (offBoardNode.center.y + otherNode.center.y) / 2,
      }
      const insideMiddleNode =
        midpoint.x >= middleNode.center.x - middleNode.width / 2 &&
        midpoint.x <= middleNode.center.x + middleNode.width / 2 &&
        midpoint.y >= middleNode.center.y - middleNode.height / 2 &&
        midpoint.y <= middleNode.center.y + middleNode.height / 2
      if (insideMiddleNode) {
        return true
      }
    }
    return false
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

  getOutput(): SharedEdgeSegment[] {
    return this.sharedEdgeSegments
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

        if (!portPoint.cramped) {
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
        } else {
          graphics.rects!.push({
            center: { x: portPoint.x, y: portPoint.y },
            width: 0.1,
            height: 0.1,
            fill: color,
            layer: `z${portPoint.availableZ.join(",")}`,
            label: `cramped ${portPoint.segmentPortPointId}`,
          })
        }
      }
    }

    return graphics
  }
}
