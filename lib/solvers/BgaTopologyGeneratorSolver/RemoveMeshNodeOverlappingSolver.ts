import {
  doBoundsOverlap,
  getBoundFromCenteredRect,
} from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNode, Obstacle } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export type RemoveMeshNodeOverlappingSolverInput = {
  meshNodes: CapacityMeshNode[]
  obstacles: Obstacle[]
  layerCount: number
}

export class RemoveMeshNodeOverlppingWithUnmarkedObstacle extends BaseSolver {
  obstacleQueue: Obstacle[] = []
  obstacleQueueIndex: number = 0
  meshNodes: CapacityMeshNode[] = []

  constructor(
    public readonly inputProblem: RemoveMeshNodeOverlappingSolverInput,
  ) {
    super()
  }

  override _setup(): void {
    this.obstacleQueue = this.inputProblem.obstacles
    this.obstacleQueueIndex = 0
    this.meshNodes = [...this.inputProblem.meshNodes]
  }

  override _step(): void {
    if (this.obstacleQueueIndex >= this.obstacleQueue.length) {
      this.solved = true
      return
    }

    const obstacle: Obstacle = this.obstacleQueue[this.obstacleQueueIndex]!
    const obstacleAvailableZ: number[] = obstacle.layers.map((layerName) =>
      mapLayerNameToZ(layerName, this.inputProblem.layerCount),
    )
    const nextMeshNodes: CapacityMeshNode[] = []

    for (const node of this.meshNodes) {
      if (node._containsObstacle) {
        nextMeshNodes.push(node)
        continue
      }

      const sharesObstacleLayer: boolean = obstacleAvailableZ.some((z) =>
        node.availableZ.includes(z),
      )

      if (!sharesObstacleLayer) {
        nextMeshNodes.push(node)
        continue
      }

      const overlapsObstacle: boolean = doBoundsOverlap(
        getBoundFromCenteredRect(node),
        getBoundFromCenteredRect(obstacle),
      )

      if (!overlapsObstacle) {
        nextMeshNodes.push(node)
        continue
      }

      if (node.availableZ.length === 1) {
        continue
      }

      const nodeFreeLayers: number[] = node.availableZ.filter(
        (z) => !obstacleAvailableZ.includes(z),
      )

      for (const z of nodeFreeLayers) {
        const nextMeshNode: CapacityMeshNode = {
          ...node,
          capacityMeshNodeId: `${node.capacityMeshNodeId}:z${z}`,
          availableZ: [z],
          layer: `z${z}`,
        }
        nextMeshNodes.push(nextMeshNode)
      }
    }

    this.meshNodes = nextMeshNodes
    this.obstacleQueueIndex += 1
    this.stats = {
      obstaclesProcessed: this.obstacleQueueIndex,
      obstacleCount: this.obstacleQueue.length,
      meshNodeCount: this.meshNodes.length,
    }
  }

  computeProgress(): number {
    if (this.obstacleQueue.length === 0) return 1
    return this.obstacleQueueIndex / this.obstacleQueue.length
  }

  override getConstructorParams(): readonly [
    RemoveMeshNodeOverlappingSolverInput,
  ] {
    return [this.inputProblem] as const
  }

  getOutput(): CapacityMeshNode[] {
    return this.meshNodes
  }

  override visualize(): GraphicsObject {
    const currentObstacle: Obstacle | null =
      this.obstacleQueueIndex < this.obstacleQueue.length
        ? this.obstacleQueue[this.obstacleQueueIndex] ?? null
        : null
    const processedObstacles: Obstacle[] = this.obstacleQueue.slice(
      0,
      this.obstacleQueueIndex,
    )
    const pendingObstacles: Obstacle[] = currentObstacle
      ? this.obstacleQueue.slice(this.obstacleQueueIndex + 1)
      : []

    return {
      rects: [
        ...processedObstacles.map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(160,160,160,0.10)",
          stroke: "rgba(160,160,160,0.35)",
          label: `processed ${obstacle.obstacleId ?? "obstacle"}`,
        })),
        ...(currentObstacle
          ? [
              {
                center: currentObstacle.center,
                width: currentObstacle.width,
                height: currentObstacle.height,
                fill: "rgba(255,140,0,0.22)",
                stroke: "rgba(255,140,0,0.75)",
                label: `active ${currentObstacle.obstacleId ?? "obstacle"}`,
              },
            ]
          : []),
        ...pendingObstacles.map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(255,0,0,0.05)",
          stroke: "rgba(255,0,0,0.22)",
          label: `pending ${obstacle.obstacleId ?? "obstacle"}`,
        })),
        ...this.meshNodes.map((node) => ({
          ...createRectFromCapacityNode(node, { rectMargin: 0.01 }),
          fill: node._containsObstacle
            ? "rgba(255,0,0,0.18)"
            : "rgba(0,120,255,0.12)",
          stroke: node._containsObstacle
            ? "rgba(255,0,0,0.45)"
            : "rgba(0,120,255,0.45)",
        })),
      ],
    }
  }
}
