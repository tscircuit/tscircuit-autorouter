import type { GraphicsObject } from "graphics-debug"
import { CapacityNodeTree } from "lib/data-structures/CapacityNodeTree"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type {
  CapacityMeshNode,
  ComponentPortPoint,
  ComponentPortPointSide,
} from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"

export interface ComponentPortPointBridgeSolverInput {
  capacityMeshNodes: CapacityMeshNode[]
  componentBaseCapacityMeshNodeIds: string[]
  sharedEdgeSegments: SharedEdgeSegment[]
}

type NodeBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type BridgeSegmentCandidate = {
  componentNode: CapacityMeshNode
  globalNode: CapacityMeshNode
  start: { x: number; y: number }
  end: { x: number; y: number }
  availableZ: number[]
  componentPortPoint?: ComponentPortPoint
}

const GEOMETRY_EPSILON = 0.001
const NEARBY_NODE_SEARCH_MARGIN = 1

function getNodeBounds(node: CapacityMeshNode): NodeBounds {
  return {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }
}

function getSharedZLayers(
  componentNode: CapacityMeshNode,
  globalNode: CapacityMeshNode,
): number[] {
  return componentNode.availableZ.filter((z) =>
    globalNode.availableZ.includes(z),
  )
}

function isDerivedFromComponentBaseNode(
  node: CapacityMeshNode,
  componentBaseNodeIds: Set<string>,
): boolean {
  if (componentBaseNodeIds.has(node.capacityMeshNodeId)) return true

  for (const componentBaseNodeId of componentBaseNodeIds) {
    if (node.capacityMeshNodeId.startsWith(`${componentBaseNodeId}__sub_`)) {
      return true
    }
  }

  return false
}

function getExistingSegmentPairKey(segment: SharedEdgeSegment): string {
  const sortedNodeIds = [...segment.nodeIds].sort()
  return `${sortedNodeIds[0]}::${sortedNodeIds[1]}`
}

function getNodePairKey(
  nodeA: CapacityMeshNode,
  nodeB: CapacityMeshNode,
): string {
  return [nodeA.capacityMeshNodeId, nodeB.capacityMeshNodeId].sort().join("::")
}

function computeTouchingBoundarySegment(
  componentNode: CapacityMeshNode,
  globalNode: CapacityMeshNode,
): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  const componentBounds = getNodeBounds(componentNode)
  const globalBounds = getNodeBounds(globalNode)
  const xOverlapStart = Math.max(componentBounds.minX, globalBounds.minX)
  const xOverlapEnd = Math.min(componentBounds.maxX, globalBounds.maxX)
  const yOverlapStart = Math.max(componentBounds.minY, globalBounds.minY)
  const yOverlapEnd = Math.min(componentBounds.maxY, globalBounds.maxY)
  const xOverlap = xOverlapEnd - xOverlapStart
  const yOverlap = yOverlapEnd - yOverlapStart

  if (xOverlap < -GEOMETRY_EPSILON || yOverlap < -GEOMETRY_EPSILON) {
    return null
  }

  if (xOverlap < yOverlap && yOverlap >= GEOMETRY_EPSILON) {
    const x = (xOverlapStart + xOverlapEnd) / 2
    return {
      start: { x, y: yOverlapStart },
      end: { x, y: yOverlapEnd },
    }
  }

  if (yOverlap >= -GEOMETRY_EPSILON && xOverlap >= GEOMETRY_EPSILON) {
    const y = (yOverlapStart + yOverlapEnd) / 2
    return {
      start: { x: xOverlapStart, y },
      end: { x: xOverlapEnd, y },
    }
  }

  return null
}

function getComponentBoundarySide(
  componentNode: CapacityMeshNode,
  boundary: { start: { x: number; y: number }; end: { x: number; y: number } },
): ComponentPortPointSide | null {
  const componentBounds = getNodeBounds(componentNode)
  const isVertical =
    Math.abs(boundary.start.x - boundary.end.x) <= GEOMETRY_EPSILON
  const isHorizontal =
    Math.abs(boundary.start.y - boundary.end.y) <= GEOMETRY_EPSILON

  if (
    isVertical &&
    Math.abs(boundary.start.x - componentBounds.maxX) <= GEOMETRY_EPSILON
  ) {
    return "right"
  }
  if (
    isVertical &&
    Math.abs(boundary.start.x - componentBounds.minX) <= GEOMETRY_EPSILON
  ) {
    return "left"
  }
  if (
    isHorizontal &&
    Math.abs(boundary.start.y - componentBounds.minY) <= GEOMETRY_EPSILON
  ) {
    return "top"
  }
  if (
    isHorizontal &&
    Math.abs(boundary.start.y - componentBounds.maxY) <= GEOMETRY_EPSILON
  ) {
    return "bottom"
  }

  return null
}

function isComponentPortPointOnBoundary(
  componentPortPoint: ComponentPortPoint,
  boundary: { start: { x: number; y: number }; end: { x: number; y: number } },
): boolean {
  const minX = Math.min(boundary.start.x, boundary.end.x) - GEOMETRY_EPSILON
  const maxX = Math.max(boundary.start.x, boundary.end.x) + GEOMETRY_EPSILON
  const minY = Math.min(boundary.start.y, boundary.end.y) - GEOMETRY_EPSILON
  const maxY = Math.max(boundary.start.y, boundary.end.y) + GEOMETRY_EPSILON
  const isVertical =
    Math.abs(boundary.start.x - boundary.end.x) <= GEOMETRY_EPSILON
  const isHorizontal =
    Math.abs(boundary.start.y - boundary.end.y) <= GEOMETRY_EPSILON

  if (isVertical) {
    return (
      Math.abs(componentPortPoint.x - boundary.start.x) <= GEOMETRY_EPSILON &&
      componentPortPoint.y >= minY &&
      componentPortPoint.y <= maxY
    )
  }
  if (isHorizontal) {
    return (
      Math.abs(componentPortPoint.y - boundary.start.y) <= GEOMETRY_EPSILON &&
      componentPortPoint.x >= minX &&
      componentPortPoint.x <= maxX
    )
  }

  return (
    componentPortPoint.x >= minX &&
    componentPortPoint.x <= maxX &&
    componentPortPoint.y >= minY &&
    componentPortPoint.y <= maxY
  )
}

function getBridgeableComponentPortPoints(
  componentNode: CapacityMeshNode,
  globalNode: CapacityMeshNode,
  boundary: { start: { x: number; y: number }; end: { x: number; y: number } },
): ComponentPortPoint[] {
  const boundarySide = getComponentBoundarySide(componentNode, boundary)
  if (!boundarySide) return []

  return (componentNode._componentPortPoints ?? []).filter(
    (componentPortPoint) =>
      componentPortPoint.side === boundarySide &&
      isComponentPortPointOnBoundary(componentPortPoint, boundary) &&
      componentPortPoint.availableZ.some((z) =>
        globalNode.availableZ.includes(z),
      ),
  )
}

function createBridgePortPoints(
  bridgeSegmentId: string,
  candidate: BridgeSegmentCandidate,
): SegmentPortPoint[] {
  const centerX =
    candidate.componentPortPoint?.x ?? (candidate.start.x + candidate.end.x) / 2
  const centerY =
    candidate.componentPortPoint?.y ?? (candidate.start.y + candidate.end.y) / 2

  return candidate.availableZ.map((z) => ({
    segmentPortPointId: `${bridgeSegmentId}_pp0_z${z}`,
    x: centerX,
    y: centerY,
    availableZ: [z],
    nodeIds: [
      candidate.componentNode.capacityMeshNodeId,
      candidate.globalNode.capacityMeshNodeId,
    ],
    edgeId: bridgeSegmentId,
    connectionName: null,
    distToCentermostPortOnZ: 0,
    cramped: false,
  }))
}

export class ComponentPortPointBridgeSolver extends BaseSolver {
  private output: SharedEdgeSegment[] = []
  private bridgeSegments: SharedEdgeSegment[] = []

  constructor(private readonly input: ComponentPortPointBridgeSolverInput) {
    super()
    this.MAX_ITERATIONS = 1
  }

  override getConstructorParams(): readonly [
    ComponentPortPointBridgeSolverInput,
  ] {
    return [this.input] as const
  }

  override _step(): void {
    const componentBaseNodeIds = new Set(
      this.input.componentBaseCapacityMeshNodeIds,
    )
    const existingSegmentPairKeys = new Set(
      this.input.sharedEdgeSegments.map(getExistingSegmentPairKey),
    )
    const componentNodes = this.input.capacityMeshNodes.filter(
      (node) =>
        !node._containsObstacle &&
        isDerivedFromComponentBaseNode(node, componentBaseNodeIds),
    )
    const globalNodes = this.input.capacityMeshNodes.filter(
      (node) =>
        !node._containsObstacle &&
        !isDerivedFromComponentBaseNode(node, componentBaseNodeIds),
    )
    const globalNodeTree = new CapacityNodeTree(globalNodes)

    for (const componentNode of componentNodes) {
      const nearbyGlobalNodes = globalNodeTree.getNodesInArea(
        componentNode.center.x,
        componentNode.center.y,
        componentNode.width + NEARBY_NODE_SEARCH_MARGIN * 2,
        componentNode.height + NEARBY_NODE_SEARCH_MARGIN * 2,
      )

      for (const globalNode of nearbyGlobalNodes) {
        const pairKey = getNodePairKey(componentNode, globalNode)

        const availableZ = getSharedZLayers(componentNode, globalNode)
        if (availableZ.length === 0) continue

        const bridgeBoundary = computeTouchingBoundarySegment(
          componentNode,
          globalNode,
        )
        if (!bridgeBoundary) continue

        const bridgeableComponentPortPoints = getBridgeableComponentPortPoints(
          componentNode,
          globalNode,
          bridgeBoundary,
        )
        if (bridgeableComponentPortPoints.length > 0) {
          for (const componentPortPoint of bridgeableComponentPortPoints) {
            const bridgeAvailableZ = componentPortPoint.availableZ.filter((z) =>
              globalNode.availableZ.includes(z),
            )
            const bridgeSegmentId = `component_bridge_${this.bridgeSegments.length}`
            const candidate: BridgeSegmentCandidate = {
              componentNode,
              globalNode,
              start: bridgeBoundary.start,
              end: bridgeBoundary.end,
              availableZ: bridgeAvailableZ,
              componentPortPoint,
            }
            this.bridgeSegments.push({
              edgeId: bridgeSegmentId,
              nodeIds: [
                componentNode.capacityMeshNodeId,
                globalNode.capacityMeshNodeId,
              ],
              start: bridgeBoundary.start,
              end: bridgeBoundary.end,
              availableZ: bridgeAvailableZ,
              portPoints: createBridgePortPoints(bridgeSegmentId, candidate),
            })
          }
          existingSegmentPairKeys.add(pairKey)
          continue
        }

        if (
          componentNode._componentPortPoints ||
          existingSegmentPairKeys.has(pairKey)
        ) {
          continue
        }

        const bridgeSegmentId = `component_bridge_${this.bridgeSegments.length}`
        const candidate: BridgeSegmentCandidate = {
          componentNode,
          globalNode,
          start: bridgeBoundary.start,
          end: bridgeBoundary.end,
          availableZ,
        }
        this.bridgeSegments.push({
          edgeId: bridgeSegmentId,
          nodeIds: [
            componentNode.capacityMeshNodeId,
            globalNode.capacityMeshNodeId,
          ],
          start: bridgeBoundary.start,
          end: bridgeBoundary.end,
          availableZ,
          portPoints: createBridgePortPoints(bridgeSegmentId, candidate),
        })
        existingSegmentPairKeys.add(pairKey)
      }
    }

    this.output = [...this.input.sharedEdgeSegments, ...this.bridgeSegments]
    this.stats = {
      componentBaseNodeCount:
        this.input.componentBaseCapacityMeshNodeIds.length,
      componentNodeCount: componentNodes.length,
      componentPortPointCount: componentNodes.reduce(
        (count, node) => count + (node._componentPortPoints?.length ?? 0),
        0,
      ),
      globalNodeCount: globalNodes.length,
      inputSharedEdgeSegmentCount: this.input.sharedEdgeSegments.length,
      bridgeSegmentCount: this.bridgeSegments.length,
      outputSharedEdgeSegmentCount: this.output.length,
    }
    this.solved = true
  }

  getOutput(): SharedEdgeSegment[] {
    if (!this.solved) {
      throw new Error("ComponentPortPointBridgeSolver has not solved yet")
    }

    return this.output
  }

  override visualize(): GraphicsObject {
    const componentBaseNodeIds = new Set(
      this.input.componentBaseCapacityMeshNodeIds,
    )
    const componentNodes = this.input.capacityMeshNodes.filter((node) =>
      isDerivedFromComponentBaseNode(node, componentBaseNodeIds),
    )
    const componentPortPointGraphics = componentNodes.flatMap((node) =>
      (node._componentPortPoints ?? []).map((componentPortPoint) => ({
        x: componentPortPoint.x,
        y: componentPortPoint.y,
        color: "rgba(0, 95, 210, 0.95)",
        label: [
          componentPortPoint.componentPortPointId,
          componentPortPoint.side,
          `z${componentPortPoint.availableZ.join(",")}`,
        ].join("\n"),
      })),
    )
    const bridgePortPointGraphics = this.bridgeSegments.flatMap((segment) =>
      segment.portPoints.map((portPoint) => ({
        x: portPoint.x,
        y: portPoint.y,
        color: "rgba(230, 130, 0, 0.95)",
        label: `${portPoint.segmentPortPointId}\nz${portPoint.availableZ.join(",")}`,
      })),
    )

    return {
      rects: componentNodes.map((node) => ({
        ...createRectFromCapacityNode(node, {
          rectMargin: 0.01,
          zOffset: 0.02,
        }),
        fill: "rgba(255, 190, 40, 0.12)",
        stroke: "rgba(180, 120, 0, 0.42)",
        label: `component bridge node\n${node.capacityMeshNodeId}`,
      })),
      lines: this.bridgeSegments.map((segment) => ({
        points: [segment.start, segment.end],
        strokeColor: "rgba(230, 130, 0, 0.88)",
        strokeWidth: 0.04,
        label: `${segment.edgeId}\n${segment.nodeIds.join(" <-> ")}`,
      })),
      points: [...componentPortPointGraphics, ...bridgePortPointGraphics],
      circles: [],
    }
  }
}
