import {
  doBoundsOverlap,
  getBoundFromCenteredRect,
} from "@tscircuit/math-utils"
import {
  BasePipelineSolver,
  BaseSolver,
  PipelineStep,
  definePipelineStep,
} from "@tscircuit/solver-utils"
import { InitialBgaTopologySolver } from "lib/solvers/BgaTopologyGeneratorSolver/InitialBgaTopologySolver"
import {
  TopologyGenerator,
  type TopologyGeneratorSolverOutput,
  type TopologyGeneratorSolverParams,
} from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import type { CapacityMeshNode, Obstacle } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type RemoveMeshNodeOverlappingInput = {
  meshNodes: CapacityMeshNode[]
  obstacles: Obstacle[]
  layerCount: number
}

function doesNodeOverlapObstacle(
  node: CapacityMeshNode,
  obstacle: Obstacle,
): boolean {
  return doBoundsOverlap(
    getBoundFromCenteredRect(node),
    getBoundFromCenteredRect(obstacle),
  )
}

class RemoveMeshNodeOverlapping extends BaseSolver {
  obstacleQueue: Obstacle[] = []
  obstacleQueueIndex = 0
  meshNodes: CapacityMeshNode[] = []

  constructor(public readonly inputProblem: RemoveMeshNodeOverlappingInput) {
    super()
  }

  override _setup(): void {
    this.obstacleQueue = this.inputProblem.obstacles
    this.obstacleQueueIndex = 0
    this.meshNodes = [...this.inputProblem.meshNodes]
    this.MAX_ITERATIONS = Math.max(1_000, this.obstacleQueue.length + 1)
  }

  override _step(): void {
    if (this.obstacleQueueIndex >= this.obstacleQueue.length) {
      this.solved = true
      return
    }

    const obstacle = this.obstacleQueue[this.obstacleQueueIndex]!
    const nextMeshNodes: CapacityMeshNode[] = []

    for (const node of this.meshNodes) {
      if (node._containsObstacle) {
        nextMeshNodes.push(node)
        continue
      }
      const availableZ = obstacle.layers.map((e) =>
        mapLayerNameToZ(e, this.inputProblem.layerCount),
      )
      if (
        availableZ.some((o) => {
          return node.availableZ.includes(o)
        })
      ) {
        if (doesNodeOverlapObstacle(node, obstacle)) {
          if (node.availableZ.length === 1) {
            continue
          }

          const freeLayerBetweenObstacleAndNodes = node.availableZ.filter(
            (z) => !availableZ.includes(z),
          )
          freeLayerBetweenObstacleAndNodes.forEach((z) => {
            nextMeshNodes.push({
              ...node,
              availableZ: [z],
              layer: `z${z}`,
            })
          })
          continue
        }
      }
      nextMeshNodes.push(node)
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

  override getConstructorParams(): readonly [RemoveMeshNodeOverlappingInput] {
    return [this.inputProblem] as const
  }

  getOutput(): CapacityMeshNode[] {
    return this.meshNodes
  }
}

export class BgaTopologyGeneratorSolver extends BasePipelineSolver<any> {
  static readonly componentKind = "bga"
  initialTopologySolver!: InitialBgaTopologySolver
  mergeObstacleMeshNodes!: RemoveMeshNodeOverlapping

  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "initialTopologySolver",
      InitialBgaTopologySolver,
      (solver: BgaTopologyGeneratorSolver) => [
        {
          srj: solver.inputProblem.inputSrj,
          componentBounds: solver.inputProblem.detectedComponent.bounds,
          componentId: solver.inputProblem.detectedComponent.componentId,
        },
      ],
    ),
    definePipelineStep(
      "mergeObstacleMeshNodes",
      RemoveMeshNodeOverlapping,
      (solver: BgaTopologyGeneratorSolver) => [
        {
          meshNodes: solver.initialTopologySolver.getOutput().routingRegions,
          obstacles: solver.inputProblem.inputSrj.obstacles.filter(
            (obstacle) =>
              doBoundsOverlap(
                solver.inputProblem.detectedComponent.bounds,
                getBoundFromCenteredRect(obstacle),
              ) &&
              obstacle.componentId !==
                solver.inputProblem.detectedComponent.componentId,
          ),
          layerCount: solver.inputProblem.inputSrj.layerCount,
        },
      ],
    ),
  ]

  constructor(public readonly inputProblem: TopologyGeneratorSolverParams) {
    super(inputProblem)
  }

  override getConstructorParams(): readonly [TopologyGeneratorSolverParams] {
    return [this.inputProblem] as const
  }

  getOutput(): TopologyGeneratorSolverOutput {
    return {
      routingRegions: this.mergeObstacleMeshNodes.getOutput(),
    }
  }
}

TopologyGenerator.register(BgaTopologyGeneratorSolver)
