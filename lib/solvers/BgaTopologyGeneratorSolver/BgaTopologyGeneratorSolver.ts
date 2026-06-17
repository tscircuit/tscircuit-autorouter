import {
  doBoundsOverlap,
  getBoundFromCenteredRect,
} from "@tscircuit/math-utils"
import { BasePipelineSolver, definePipelineStep } from "@tscircuit/solver-utils"
import type { BaseSolver, PipelineStep } from "@tscircuit/solver-utils"
import { InitialBgaTopologySolver } from "lib/solvers/BgaTopologyGeneratorSolver/InitialBgaTopologySolver"
import { RemoveMeshNodeOverlppingWithUnmarkedObstacle } from "lib/solvers/BgaTopologyGeneratorSolver/RemoveMeshNodeOverlappingSolver"
import {
  TopologyGenerator,
  type TopologyGeneratorSolverOutput,
  type TopologyGeneratorSolverParams,
} from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import type { CapacityMeshNode, Obstacle } from "lib/types"

export class BgaTopologyGeneratorSolver extends BasePipelineSolver<TopologyGeneratorSolverParams> {
  static readonly componentKind = "bga"
  initialTopologySolver?: InitialBgaTopologySolver
  removeMeshNodeOverlppingWithUnmarkedObstacle?: RemoveMeshNodeOverlppingWithUnmarkedObstacle
  markedComponentObstacles: Obstacle[] = []
  unmarkedComponentObstacles: Obstacle[] = []

  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "initialTopologySolver",
      InitialBgaTopologySolver,
      (solverInstance: BgaTopologyGeneratorSolver) => [
        {
          srj: solverInstance.inputProblem.inputSrj,
          componentBounds: solverInstance.inputProblem.detectedComponent.bounds,
          componentId:
            solverInstance.inputProblem.detectedComponent.componentId,
          markedComponentObstacles: solverInstance.markedComponentObstacles,
          unmarkedComponentObstacles: solverInstance.unmarkedComponentObstacles,
        },
      ],
    ),
    definePipelineStep(
      "removeMeshNodeOverlppingWithUnmarkedObstacle",
      RemoveMeshNodeOverlppingWithUnmarkedObstacle,
      (solverInstance: BgaTopologyGeneratorSolver) => [
        {
          meshNodes:
            solverInstance.initialTopologySolver?.getOutput().routingRegions ??
            [],
          obstacles: solverInstance.unmarkedComponentObstacles,
          layerCount: solverInstance.inputProblem.inputSrj.layerCount,
        },
      ],
    ),
  ]

  constructor(public readonly inputProblem: TopologyGeneratorSolverParams) {
    super(inputProblem)
  }

  override _setup(): void {
    const componentBounds = this.inputProblem.detectedComponent.bounds
    const componentId = this.inputProblem.detectedComponent.componentId
    const markedComponentObstacles: Obstacle[] = []
    const unmarkedComponentObstacles: Obstacle[] = []

    for (const obstacle of this.inputProblem.inputSrj.obstacles) {
      if (
        !doBoundsOverlap(componentBounds, getBoundFromCenteredRect(obstacle))
      ) {
        continue
      }

      if (obstacle.componentId === componentId) {
        markedComponentObstacles.push(obstacle)
        continue
      }

      unmarkedComponentObstacles.push(obstacle)
    }

    this.markedComponentObstacles = markedComponentObstacles
    this.unmarkedComponentObstacles = unmarkedComponentObstacles
  }

  override getConstructorParams(): readonly [TopologyGeneratorSolverParams] {
    return [this.inputProblem] as const
  }

  override getOutput(): TopologyGeneratorSolverOutput {
    const routingRegions: CapacityMeshNode[] =
      this.removeMeshNodeOverlppingWithUnmarkedObstacle?.getOutput() ?? []

    return {
      routingRegions,
    }
  }
}

TopologyGenerator.register(BgaTopologyGeneratorSolver)
