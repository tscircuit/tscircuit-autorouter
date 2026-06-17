import type { Bounds } from "@tscircuit/math-utils"
import { getBoundFromCenteredRect } from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import Flatbush from "flatbush"
import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNode } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import type {
  DetectEdgesNotConnectedToMeshInput,
  EdgeSegmentWithObstacle,
} from "./BgaGapFillTypes"

const EDGE_EPSILON: number = 1e-3
const EDGE_SEARCH_MARGIN: number = 1e-3

export class DetectEdgesNotConnectedToMesh extends BaseSolver {
  private meshIndex!: Flatbush
  private queueEdges: EdgeSegmentWithObstacle[] = []
  private disconnectedEdges: EdgeSegmentWithObstacle[] = []
  private currentEdge: EdgeSegmentWithObstacle | null = null

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

    const queueEdges: EdgeSegmentWithObstacle[] = []

    for (const obstacle of this.inputProblem.unmarkedComponentObstacles) {
      const obstacleBounds: Bounds = getBoundFromCenteredRect(obstacle)

      queueEdges.push(
        {
          obstacle,
          start: { x: obstacleBounds.minX, y: obstacleBounds.minY },
          end: { x: obstacleBounds.minX, y: obstacleBounds.maxY },
          expansionDirection: { x: -1, y: 0 },
        },
        {
          obstacle,
          start: { x: obstacleBounds.maxX, y: obstacleBounds.minY },
          end: { x: obstacleBounds.maxX, y: obstacleBounds.maxY },
          expansionDirection: { x: 1, y: 0 },
        },
        {
          obstacle,
          start: { x: obstacleBounds.minX, y: obstacleBounds.minY },
          end: { x: obstacleBounds.maxX, y: obstacleBounds.minY },
          expansionDirection: { x: 0, y: -1 },
        },
        {
          obstacle,
          start: { x: obstacleBounds.minX, y: obstacleBounds.maxY },
          end: { x: obstacleBounds.maxX, y: obstacleBounds.maxY },
          expansionDirection: { x: 0, y: 1 },
        },
      )
    }

    this.queueEdges = queueEdges
    this.currentEdge = null
  }

  override _step(): void {
    const currentEdge: EdgeSegmentWithObstacle | undefined =
      this.queueEdges.shift()

    if (!currentEdge) {
      this.currentEdge = null
      this.solved = true
      return
    }

    this.currentEdge = currentEdge

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

    const candidateNodeIds: number[] = this.meshIndex.search(
      searchBounds.minX,
      searchBounds.minY,
      searchBounds.maxX,
      searchBounds.maxY,
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
          break
        }

        if (
          currentEdge.expansionDirection.x === 1 &&
          Math.abs(meshNodeBounds.minX - currentEdge.start.x) <= EDGE_EPSILON
        ) {
          isConnected = true
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
        break
      }

      if (
        currentEdge.expansionDirection.y === 1 &&
        Math.abs(meshNodeBounds.minY - currentEdge.start.y) <= EDGE_EPSILON
      ) {
        isConnected = true
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
    const pendingEdges: EdgeSegmentWithObstacle[] = this.queueEdges
    const disconnectedEdges: EdgeSegmentWithObstacle[] = this.disconnectedEdges

    return {
      rects: [
        ...this.inputProblem.meshNodes.map((meshNode: CapacityMeshNode) => ({
          ...createRectFromCapacityNode(meshNode, { rectMargin: 0.01 }),
          fill: meshNode._containsObstacle
            ? "rgba(120,120,120,0.18)"
            : "rgba(120,120,120,0.08)",
          stroke: meshNode._containsObstacle
            ? "rgba(120,120,120,0.42)"
            : "rgba(120,120,120,0.24)",
        })),
        ...this.inputProblem.unmarkedComponentObstacles.map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(160,160,160,0.10)",
          stroke: "rgba(160,160,160,0.40)",
          label: obstacle.obstacleId ?? obstacle.componentId ?? "obstacle",
        })),
      ],
      lines: [
        ...pendingEdges.map((edge: EdgeSegmentWithObstacle) => ({
          points: [edge.start, edge.end],
          stroke: "rgba(160,160,160,0.55)",
          strokeWidth: 0.02,
        })),
        ...disconnectedEdges.map((edge: EdgeSegmentWithObstacle) => ({
          points: [edge.start, edge.end],
          stroke: "rgba(255,0,0,0.95)",
          strokeWidth: 0.04,
        })),
        ...(this.currentEdge
          ? [
              {
                points: [this.currentEdge.start, this.currentEdge.end],
                stroke: "rgba(255,140,0,0.98)",
                strokeWidth: 0.05,
              },
            ]
          : []),
      ],
    }
  }
}
