import type { Bounds } from "@tscircuit/math-utils"
import { getBoundFromCenteredRect } from "@tscircuit/math-utils"
import { getBoundsCenter } from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import Flatbush from "flatbush"
import type { GraphicsObject, Line, Point, Rect } from "graphics-debug"
import type { CapacityMeshNode } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import type {
  DetectEdgesNotConnectedToMeshInput,
  EdgeSegmentWithObstacle,
} from "./BgaGapFillTypes"
import {
  getGapFillEdgeColor,
  getGapFillEdgeDirectionLabel,
  getGapFillEdgeMidpoint,
  getGapFillEdgeVisualId,
  getGapFillObstacleEdges,
  sortGapFillEdgesByLocation,
} from "./gapFillVisualization"

const EDGE_EPSILON: number = 1e-3
const EDGE_SEARCH_MARGIN: number = 1e-3

export class DetectEdgesNotConnectedToMesh extends BaseSolver {
  private meshIndex!: Flatbush
  private allEdges: EdgeSegmentWithObstacle[] = []
  private queueEdges: EdgeSegmentWithObstacle[] = []
  private disconnectedEdges: EdgeSegmentWithObstacle[] = []
  private currentEdge: EdgeSegmentWithObstacle | null = null
  private lastSearchBounds: Bounds | null = null
  private lastCandidateMeshNodes: CapacityMeshNode[] = []
  private lastMatchedMeshNode: CapacityMeshNode | null = null

  constructor(
    public readonly inputProblem: DetectEdgesNotConnectedToMeshInput,
  ) {
    super()
  }

  override _setup(): void {
    const meshNodeCount: number = Math.max(
      this.inputProblem.meshNodes.length,
      1,
    )
    this.meshIndex = new Flatbush(meshNodeCount)

    for (const meshNode of this.inputProblem.meshNodes) {
      const meshNodeBounds: Bounds = getBoundFromCenteredRect(meshNode)
      this.meshIndex.add(
        meshNodeBounds.minX,
        meshNodeBounds.minY,
        meshNodeBounds.maxX,
        meshNodeBounds.maxY,
      )
    }

    this.meshIndex.finish()

    const queueEdges: EdgeSegmentWithObstacle[] = getGapFillObstacleEdges(
      this.inputProblem.unmarkedComponentObstacles,
    )

    this.queueEdges = queueEdges
    this.allEdges = sortGapFillEdgesByLocation(queueEdges)
    this.currentEdge = null
    this.lastSearchBounds = null
    this.lastCandidateMeshNodes = []
    this.lastMatchedMeshNode = null
  }

  override _step(): void {
    const currentEdge: EdgeSegmentWithObstacle | undefined =
      this.queueEdges.shift()

    if (!currentEdge) {
      this.currentEdge = null
      this.lastSearchBounds = null
      this.lastCandidateMeshNodes = []
      this.lastMatchedMeshNode = null
      this.solved = true
      return
    }

    this.currentEdge = currentEdge
    this.lastMatchedMeshNode = null

    const edgeIsVertical: boolean =
      Math.abs(currentEdge.start.x - currentEdge.end.x) <= EDGE_EPSILON
    const searchBounds: Bounds = edgeIsVertical
      ? {
          minX: currentEdge.start.x - EDGE_SEARCH_MARGIN,
          maxX: currentEdge.start.x + EDGE_SEARCH_MARGIN,
          minY: Math.min(currentEdge.start.y, currentEdge.end.y),
          maxY: Math.max(currentEdge.start.y, currentEdge.end.y),
        }
      : {
          minX: Math.min(currentEdge.start.x, currentEdge.end.x),
          maxX: Math.max(currentEdge.start.x, currentEdge.end.x),
          minY: currentEdge.start.y - EDGE_SEARCH_MARGIN,
          maxY: currentEdge.start.y + EDGE_SEARCH_MARGIN,
        }
    this.lastSearchBounds = searchBounds

    const candidateNodeIds: number[] = this.meshIndex.search(
      searchBounds.minX,
      searchBounds.minY,
      searchBounds.maxX,
      searchBounds.maxY,
    )
    this.lastCandidateMeshNodes = candidateNodeIds.map(
      (candidateNodeId: number): CapacityMeshNode =>
        this.inputProblem.meshNodes[candidateNodeId]!,
    )

    let isConnected: boolean = false

    for (const candidateNodeId of candidateNodeIds) {
      const meshNode: CapacityMeshNode =
        this.inputProblem.meshNodes[candidateNodeId]!
      const meshNodeBounds: Bounds = getBoundFromCenteredRect(meshNode)

      if (edgeIsVertical) {
        const overlapsY: boolean =
          Math.min(
            meshNodeBounds.maxY,
            Math.max(currentEdge.start.y, currentEdge.end.y),
          ) -
            Math.max(
              meshNodeBounds.minY,
              Math.min(currentEdge.start.y, currentEdge.end.y),
            ) >
          EDGE_EPSILON

        if (!overlapsY) continue

        if (
          currentEdge.expansionDirection.x === -1 &&
          Math.abs(meshNodeBounds.maxX - currentEdge.start.x) <= EDGE_EPSILON
        ) {
          isConnected = true
          this.lastMatchedMeshNode = meshNode
          break
        }

        if (
          currentEdge.expansionDirection.x === 1 &&
          Math.abs(meshNodeBounds.minX - currentEdge.start.x) <= EDGE_EPSILON
        ) {
          isConnected = true
          this.lastMatchedMeshNode = meshNode
          break
        }

        continue
      }

      const overlapsX: boolean =
        Math.min(
          meshNodeBounds.maxX,
          Math.max(currentEdge.start.x, currentEdge.end.x),
        ) -
          Math.max(
            meshNodeBounds.minX,
            Math.min(currentEdge.start.x, currentEdge.end.x),
          ) >
        EDGE_EPSILON

      if (!overlapsX) continue

      if (
        currentEdge.expansionDirection.y === -1 &&
        Math.abs(meshNodeBounds.maxY - currentEdge.start.y) <= EDGE_EPSILON
      ) {
        isConnected = true
        this.lastMatchedMeshNode = meshNode
        break
      }

      if (
        currentEdge.expansionDirection.y === 1 &&
        Math.abs(meshNodeBounds.minY - currentEdge.start.y) <= EDGE_EPSILON
      ) {
        isConnected = true
        this.lastMatchedMeshNode = meshNode
        break
      }
    }

    if (!isConnected) {
      this.disconnectedEdges.push(currentEdge)
    }
  }

  override getOutput(): EdgeSegmentWithObstacle[] {
    return this.disconnectedEdges
  }

  override visualize(): GraphicsObject {
    const disconnectedEdges: EdgeSegmentWithObstacle[] = this.disconnectedEdges
    const allEdges: EdgeSegmentWithObstacle[] =
      this.allEdges.length > 0
        ? this.allEdges
        : [
            ...disconnectedEdges,
            ...(this.currentEdge ? [this.currentEdge] : []),
          ]
    const currentEdgeColor = this.currentEdge
      ? getGapFillEdgeColor(this.currentEdge, 0.88)
      : "rgba(40,40,40,0.4)"
    const meshRects: Rect[] = this.inputProblem.meshNodes.map(
      (meshNode: CapacityMeshNode): Rect => ({
        ...createRectFromCapacityNode(meshNode, { rectMargin: 0.01 }),
        fill: meshNode._containsObstacle
          ? "rgba(120,120,120,0.18)"
          : "rgba(120,120,120,0.08)",
        stroke: meshNode._containsObstacle
          ? "rgba(120,120,120,0.42)"
          : "rgba(120,120,120,0.24)",
      }),
    )
    const searchBandRects: Rect[] =
      this.lastSearchBounds && this.currentEdge
        ? [
            {
              center: getBoundsCenter(this.lastSearchBounds),
              width: this.lastSearchBounds.maxX - this.lastSearchBounds.minX,
              height: this.lastSearchBounds.maxY - this.lastSearchBounds.minY,
              fill: getGapFillEdgeColor(this.currentEdge, 0.1),
              stroke: getGapFillEdgeColor(this.currentEdge, 0.36),
              label: [
                getGapFillEdgeVisualId(this.currentEdge, allEdges),
                "search band",
              ].join(" "),
            },
          ]
        : []
    const candidateMeshRects: Rect[] = this.lastCandidateMeshNodes.map(
      (meshNode: CapacityMeshNode): Rect => ({
        ...createRectFromCapacityNode(meshNode, { rectMargin: 0.018 }),
        fill:
          meshNode === this.lastMatchedMeshNode
            ? "rgba(0,180,90,0.24)"
            : this.currentEdge
              ? getGapFillEdgeColor(this.currentEdge, 0.16)
              : "rgba(80,120,160,0.16)",
        stroke:
          meshNode === this.lastMatchedMeshNode
            ? "rgba(0,150,80,0.88)"
            : currentEdgeColor,
        label: [
          meshNode === this.lastMatchedMeshNode ? "matched" : "candidate",
          meshNode.capacityMeshNodeId,
          `z:${meshNode.availableZ.join(",")}`,
        ].join("\n"),
      }),
    )
    const obstacleRects: Rect[] =
      this.inputProblem.unmarkedComponentObstacles.map(
        (obstacle): Rect => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(160,160,160,0.10)",
          stroke: "rgba(160,160,160,0.40)",
          label: obstacle.obstacleId ?? obstacle.componentId ?? "obstacle",
        }),
      )
    const disconnectedLines: Line[] = disconnectedEdges.map(
      (edge: EdgeSegmentWithObstacle): Line => ({
        points: [edge.start, edge.end],
        strokeColor: getGapFillEdgeColor(edge, 0.14),
        strokeWidth: 0.01,
        strokeDash: "5 4",
        label: [
          getGapFillEdgeVisualId(edge, allEdges),
          getGapFillEdgeDirectionLabel(edge),
          "disconnected",
        ].join(" "),
      }),
    )
    const currentEdgeLines: Line[] = []
    const currentEdgePoints: Point[] = []

    if (this.currentEdge) {
      const currentEdgeMidpoint: Point = getGapFillEdgeMidpoint(
        this.currentEdge,
      )
      currentEdgeLines.push(
        {
          points: [this.currentEdge.start, this.currentEdge.end],
          strokeColor: getGapFillEdgeColor(this.currentEdge, 1),
          strokeWidth: 0.06,
          label: [
            getGapFillEdgeVisualId(this.currentEdge, allEdges),
            getGapFillEdgeDirectionLabel(this.currentEdge),
            "checking",
          ].join(" "),
        },
        {
          points: [
            currentEdgeMidpoint,
            {
              x:
                currentEdgeMidpoint.x +
                this.currentEdge.expansionDirection.x * 0.16,
              y:
                currentEdgeMidpoint.y +
                this.currentEdge.expansionDirection.y * 0.16,
            },
          ],
          strokeColor: getGapFillEdgeColor(this.currentEdge, 0.82),
          strokeWidth: 0.02,
          strokeDash: "3 3",
        },
      )
      currentEdgePoints.push({
        ...currentEdgeMidpoint,
        color: getGapFillEdgeColor(this.currentEdge, 1),
        label: getGapFillEdgeVisualId(this.currentEdge, allEdges),
      })
    }

    return {
      rects: [
        ...meshRects,
        ...searchBandRects,
        ...candidateMeshRects,
        ...obstacleRects,
      ],
      lines: [...disconnectedLines, ...currentEdgeLines],
      points: currentEdgePoints,
    }
  }
}
