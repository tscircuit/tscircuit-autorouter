import {
  doBoundsOverlap,
  getBoundFromCenteredRect,
} from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { CapacityMeshNode, Obstacle } from "lib/types"
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
}
