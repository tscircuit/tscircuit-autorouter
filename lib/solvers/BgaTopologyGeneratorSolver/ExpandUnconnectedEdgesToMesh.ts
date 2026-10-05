import type { Bounds } from "@tscircuit/math-utils"
import { getBoundFromCenteredRect } from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import Flatbush from "flatbush"
import type { GraphicsObject, Line, Point, Rect } from "graphics-debug"
import type { CapacityMeshNode, Obstacle } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type {
  EdgeSegmentWithObstacle,
  ExpandUnconnectedEdgesToMeshInput,
} from "./BgaGapFillTypes"
import {
  getGapFillEdgeColor,
  getGapFillEdgeDirectionLabel,
  getGapFillExpandedNodeEdgeIndex,
  getGapFillEdgeMidpoint,
  getGapFillEdgeVisualId,
  sortGapFillEdgesByLocation,
} from "./gapFillVisualization"

const EDGE_EPSILON: number = 1e-3
const EDGE_SEARCH_MARGIN: number = 1e-3
const OVERLAP_EPSILON: number = 1e-6

export class ExpandUnconnectedEdgesToMesh extends BaseSolver {
  private meshIndex!: Flatbush
  private meshBounds!: Bounds
  private expandedNodes: CapacityMeshNode[] = []

  constructor(public readonly inputProblem: ExpandUnconnectedEdgesToMeshInput) {
    super()
  }

  override _setup(): void {
    const meshNodeCount: number = Math.max(
      this.inputProblem.meshNodes.length,
      1,
    )
    this.meshIndex = new Flatbush(meshNodeCount)

    let minX: number = Number.POSITIVE_INFINITY
    let maxX: number = Number.NEGATIVE_INFINITY
    let minY: number = Number.POSITIVE_INFINITY
    let maxY: number = Number.NEGATIVE_INFINITY

    for (const meshNode of this.inputProblem.meshNodes) {
      const meshNodeBounds: Bounds = getBoundFromCenteredRect(meshNode)
      this.meshIndex.add(
        meshNodeBounds.minX,
        meshNodeBounds.minY,
        meshNodeBounds.maxX,
        meshNodeBounds.maxY,
      )
      minX = Math.min(minX, meshNodeBounds.minX)
      maxX = Math.max(maxX, meshNodeBounds.maxX)
      minY = Math.min(minY, meshNodeBounds.minY)
      maxY = Math.max(maxY, meshNodeBounds.maxY)
    }

    this.meshIndex.finish()
    this.meshBounds = this.inputProblem.meshNodes.length
      ? { minX, maxX, minY, maxY }
      : { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  }

  private getObstacleAvailableZ(obstacle: Obstacle): number[] {
    return (
      obstacle.__zLayers ??
      obstacle.layers.map((layerName) =>
        mapLayerNameToZ(layerName, this.inputProblem.layerCount),
      )
    )
  }

  private getSharedOverlapArea(
    candidateNode: CapacityMeshNode,
    meshNode: CapacityMeshNode,
  ): number {
    if (
      !candidateNode.availableZ.some((z: number) =>
        meshNode.availableZ.includes(z),
      )
    ) {
      return 0
    }

    const candidateNodeBounds: Bounds = getBoundFromCenteredRect(candidateNode)
    const meshNodeBounds: Bounds = getBoundFromCenteredRect(meshNode)
    const overlapWidth: number =
      Math.min(candidateNodeBounds.maxX, meshNodeBounds.maxX) -
      Math.max(candidateNodeBounds.minX, meshNodeBounds.minX)
    const overlapHeight: number =
      Math.min(candidateNodeBounds.maxY, meshNodeBounds.maxY) -
      Math.max(candidateNodeBounds.minY, meshNodeBounds.minY)

    if (overlapWidth <= OVERLAP_EPSILON || overlapHeight <= OVERLAP_EPSILON) {
      return 0
    }

    return overlapWidth * overlapHeight
  }

  private getNodeObstacleOverlapArea(
    candidateNode: CapacityMeshNode,
    obstacle: Obstacle,
  ): number {
    const obstacleAvailableZ: number[] = this.getObstacleAvailableZ(obstacle)

    if (
      !candidateNode.availableZ.some((z: number) =>
        obstacleAvailableZ.includes(z),
      )
    ) {
      return 0
    }

    const candidateNodeBounds: Bounds = getBoundFromCenteredRect(candidateNode)
    const obstacleBounds: Bounds = getBoundFromCenteredRect(obstacle)
    const overlapWidth: number =
      Math.min(candidateNodeBounds.maxX, obstacleBounds.maxX) -
      Math.max(candidateNodeBounds.minX, obstacleBounds.minX)
    const overlapHeight: number =
      Math.min(candidateNodeBounds.maxY, obstacleBounds.maxY) -
      Math.max(candidateNodeBounds.minY, obstacleBounds.minY)

    if (overlapWidth <= OVERLAP_EPSILON || overlapHeight <= OVERLAP_EPSILON) {
      return 0
    }

    return overlapWidth * overlapHeight
  }

  private getClosestMeshNode(
    edgeWithObstacle: EdgeSegmentWithObstacle,
    expandedNodes: CapacityMeshNode[],
  ): CapacityMeshNode | null {
    const edgeIsVertical: boolean =
      Math.abs(edgeWithObstacle.start.x - edgeWithObstacle.end.x) <=
      EDGE_EPSILON
    const obstacleAvailableZ: number[] = this.getObstacleAvailableZ(
      edgeWithObstacle.obstacle,
    )
    const searchBounds: Bounds = edgeIsVertical
      ? edgeWithObstacle.expansionDirection.x < 0
        ? {
            minX: this.meshBounds.minX,
            maxX: edgeWithObstacle.start.x,
            minY:
              Math.min(edgeWithObstacle.start.y, edgeWithObstacle.end.y) -
              EDGE_SEARCH_MARGIN,
            maxY:
              Math.max(edgeWithObstacle.start.y, edgeWithObstacle.end.y) +
              EDGE_SEARCH_MARGIN,
          }
        : {
            minX: edgeWithObstacle.start.x,
            maxX: this.meshBounds.maxX,
            minY:
              Math.min(edgeWithObstacle.start.y, edgeWithObstacle.end.y) -
              EDGE_SEARCH_MARGIN,
            maxY:
              Math.max(edgeWithObstacle.start.y, edgeWithObstacle.end.y) +
              EDGE_SEARCH_MARGIN,
          }
      : edgeWithObstacle.expansionDirection.y < 0
        ? {
            minX:
              Math.min(edgeWithObstacle.start.x, edgeWithObstacle.end.x) -
              EDGE_SEARCH_MARGIN,
            maxX:
              Math.max(edgeWithObstacle.start.x, edgeWithObstacle.end.x) +
              EDGE_SEARCH_MARGIN,
            minY: this.meshBounds.minY,
            maxY: edgeWithObstacle.start.y,
          }
        : {
            minX:
              Math.min(edgeWithObstacle.start.x, edgeWithObstacle.end.x) -
              EDGE_SEARCH_MARGIN,
            maxX:
              Math.max(edgeWithObstacle.start.x, edgeWithObstacle.end.x) +
              EDGE_SEARCH_MARGIN,
            minY: edgeWithObstacle.start.y,
            maxY: this.meshBounds.maxY,
          }

    const candidateNodeIds: number[] = this.meshIndex.search(
      searchBounds.minX,
      searchBounds.minY,
      searchBounds.maxX,
      searchBounds.maxY,
    )

    let bestMeshNode: CapacityMeshNode | null = null
    let bestDistance: number = Number.POSITIVE_INFINITY

    const allCandidateNodes: CapacityMeshNode[] = [
      ...candidateNodeIds.map(
        (candidateNodeId: number): CapacityMeshNode =>
          this.inputProblem.meshNodes[candidateNodeId]!,
      ),
      ...expandedNodes,
    ]

    for (const candidateNode of allCandidateNodes) {
      if (candidateNode._containsObstacle) continue

      if (
        !candidateNode.availableZ.some((z: number) =>
          obstacleAvailableZ.includes(z),
        )
      ) {
        continue
      }

      const candidateNodeBounds: Bounds =
        getBoundFromCenteredRect(candidateNode)
      const edgeSpanOverlapAmount: number = edgeIsVertical
        ? Math.min(
            Math.max(edgeWithObstacle.start.y, edgeWithObstacle.end.y),
            candidateNodeBounds.maxY,
          ) -
          Math.max(
            Math.min(edgeWithObstacle.start.y, edgeWithObstacle.end.y),
            candidateNodeBounds.minY,
          )
        : Math.min(
            Math.max(edgeWithObstacle.start.x, edgeWithObstacle.end.x),
            candidateNodeBounds.maxX,
          ) -
          Math.max(
            Math.min(edgeWithObstacle.start.x, edgeWithObstacle.end.x),
            candidateNodeBounds.minX,
          )

      if (edgeSpanOverlapAmount <= EDGE_EPSILON) continue

      const distanceToEdge: number = edgeIsVertical
        ? edgeWithObstacle.expansionDirection.x < 0
          ? edgeWithObstacle.start.x - candidateNodeBounds.maxX
          : candidateNodeBounds.minX - edgeWithObstacle.start.x
        : edgeWithObstacle.expansionDirection.y < 0
          ? edgeWithObstacle.start.y - candidateNodeBounds.maxY
          : candidateNodeBounds.minY - edgeWithObstacle.start.y

      if (distanceToEdge < EDGE_EPSILON) continue
      if (distanceToEdge >= bestDistance) continue

      bestDistance = distanceToEdge
      bestMeshNode = candidateNode
    }

    return bestMeshNode
  }

  private createExpandedNode(
    edgeWithObstacle: EdgeSegmentWithObstacle,
    targetNode: CapacityMeshNode,
    edgeIndex: number,
  ): CapacityMeshNode | null {
    const targetNodeBounds: Bounds = getBoundFromCenteredRect(targetNode)
    const availableZ: number[] = this.getObstacleAvailableZ(
      edgeWithObstacle.obstacle,
    )
    const edgeIsVertical: boolean =
      Math.abs(edgeWithObstacle.start.x - edgeWithObstacle.end.x) <=
      EDGE_EPSILON

    if (edgeIsVertical) {
      const minY: number = Math.max(
        Math.min(edgeWithObstacle.start.y, edgeWithObstacle.end.y),
        targetNodeBounds.minY,
      )
      const maxY: number = Math.min(
        Math.max(edgeWithObstacle.start.y, edgeWithObstacle.end.y),
        targetNodeBounds.maxY,
      )
      const minX: number =
        edgeWithObstacle.expansionDirection.x < 0
          ? targetNodeBounds.maxX
          : edgeWithObstacle.start.x
      const maxX: number =
        edgeWithObstacle.expansionDirection.x < 0
          ? edgeWithObstacle.start.x
          : targetNodeBounds.minX

      if (maxX - minX <= EDGE_EPSILON || maxY - minY <= EDGE_EPSILON) {
        return null
      }

      return {
        capacityMeshNodeId: `bga-gapfill-${edgeIndex}-${edgeWithObstacle.obstacle.obstacleId ?? "no-obstacle"}-${targetNode.capacityMeshNodeId}`,
        center: {
          x: (minX + maxX) / 2,
          y: (minY + maxY) / 2,
        },
        width: maxX - minX,
        height: maxY - minY,
        layer: `z${availableZ.join(",")}`,
        availableZ,
      }
    }

    const minX: number = Math.max(
      Math.min(edgeWithObstacle.start.x, edgeWithObstacle.end.x),
      targetNodeBounds.minX,
    )
    const maxX: number = Math.min(
      Math.max(edgeWithObstacle.start.x, edgeWithObstacle.end.x),
      targetNodeBounds.maxX,
    )
    const minY: number =
      edgeWithObstacle.expansionDirection.y < 0
        ? targetNodeBounds.maxY
        : edgeWithObstacle.start.y
    const maxY: number =
      edgeWithObstacle.expansionDirection.y < 0
        ? edgeWithObstacle.start.y
        : targetNodeBounds.minY

    if (maxX - minX <= EDGE_EPSILON || maxY - minY <= EDGE_EPSILON) {
      return null
    }

    return {
      capacityMeshNodeId: `bga-gapfill-${edgeIndex}-${edgeWithObstacle.obstacle.obstacleId ?? "no-obstacle"}-${targetNode.capacityMeshNodeId}`,
      center: {
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
      },
      width: maxX - minX,
      height: maxY - minY,
      layer: `z${availableZ.join(",")}`,
      availableZ,
    }
  }

  private overlapsExistingGeometry(
    candidateNode: CapacityMeshNode,
    expandedNodes: CapacityMeshNode[],
  ): boolean {
    for (const meshNode of this.inputProblem.meshNodes) {
      if (this.getSharedOverlapArea(candidateNode, meshNode) > 0) {
        return true
      }
    }

    for (const expandedNode of expandedNodes) {
      if (this.getSharedOverlapArea(candidateNode, expandedNode) > 0) {
        return true
      }
    }

    for (const edgeWithObstacle of this.inputProblem.edgesWithObstacle) {
      if (
        this.getNodeObstacleOverlapArea(
          candidateNode,
          edgeWithObstacle.obstacle,
        ) > 0
      ) {
        return true
      }
    }

    return false
  }

  override _step(): void {
    const expandedNodes: CapacityMeshNode[] = []

    for (const [
      edgeIndex,
      edgeWithObstacle,
    ] of this.inputProblem.edgesWithObstacle.entries()) {
      const targetNode: CapacityMeshNode | null = this.getClosestMeshNode(
        edgeWithObstacle,
        expandedNodes,
      )

      if (!targetNode) continue

      const expandedNode: CapacityMeshNode | null = this.createExpandedNode(
        edgeWithObstacle,
        targetNode,
        edgeIndex,
      )

      if (!expandedNode) continue
      if (this.overlapsExistingGeometry(expandedNode, expandedNodes)) continue

      expandedNodes.push(expandedNode)
    }

    this.expandedNodes = expandedNodes
    this.solved = true
  }

  override getOutput(): CapacityMeshNode[] {
    return this.expandedNodes
  }

  override visualize(): GraphicsObject {
    const edgeByIndex = this.inputProblem.edgesWithObstacle
    const visualEdges: EdgeSegmentWithObstacle[] =
      sortGapFillEdgesByLocation(edgeByIndex)

    return {
      rects: [
        ...this.inputProblem.meshNodes.map(
          (node): Rect => ({
            ...createRectFromCapacityNode(node, { rectMargin: 0.01 }),
            fill: node._containsObstacle
              ? "rgba(255,0,0,0.16)"
              : "rgba(0,120,255,0.08)",
            stroke: node._containsObstacle
              ? "rgba(255,0,0,0.35)"
              : "rgba(0,120,255,0.28)",
          }),
        ),
        ...this.expandedNodes.map((node): Rect => {
          const edgeIndex = getGapFillExpandedNodeEdgeIndex(node)
          const edge =
            edgeIndex === null ? null : (edgeByIndex[edgeIndex] ?? null)

          return {
            ...createRectFromCapacityNode(node, {
              rectMargin: 0.012,
              zOffset: 0.01,
            }),
            fill: edge
              ? getGapFillEdgeColor(edge, 0.24)
              : "rgba(0,160,100,0.24)",
            stroke: edge
              ? getGapFillEdgeColor(edge, 0.72)
              : "rgba(0,160,100,0.68)",
            label: [
              edge ? getGapFillEdgeVisualId(edge, visualEdges) : "E?",
              "expanded",
              node.capacityMeshNodeId,
              `z:${node.availableZ.join(",")}`,
            ].join("\n"),
          }
        }),
      ],
      lines: [
        ...this.inputProblem.edgesWithObstacle.map(
          (edgeWithObstacle): Line => ({
            points: [edgeWithObstacle.start, edgeWithObstacle.end],
            strokeColor: getGapFillEdgeColor(edgeWithObstacle, 0.9),
            strokeWidth: 0.034,
            label: [
              getGapFillEdgeVisualId(edgeWithObstacle, visualEdges),
              getGapFillEdgeDirectionLabel(edgeWithObstacle),
            ].join(" "),
          }),
        ),
        ...this.inputProblem.edgesWithObstacle.map((edgeWithObstacle): Line => {
          const midpoint = getGapFillEdgeMidpoint(edgeWithObstacle)
          return {
            points: [
              midpoint,
              {
                x: midpoint.x + edgeWithObstacle.expansionDirection.x * 0.16,
                y: midpoint.y + edgeWithObstacle.expansionDirection.y * 0.16,
              },
            ],
            strokeColor: getGapFillEdgeColor(edgeWithObstacle, 0.7),
            strokeWidth: 0.016,
            strokeDash: "3 3",
          }
        }),
      ],
      points: this.inputProblem.edgesWithObstacle.map(
        (edgeWithObstacle): Point => ({
          ...getGapFillEdgeMidpoint(edgeWithObstacle),
          color: getGapFillEdgeColor(edgeWithObstacle, 0.95),
          label: getGapFillEdgeVisualId(edgeWithObstacle, visualEdges),
        }),
      ),
    }
  }
}
