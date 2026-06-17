import { doBoundsOverlap, getBoundFromCenteredRect } from "@tscircuit/math-utils"
import { BasePipelineSolver, definePipelineStep } from "@tscircuit/solver-utils"
import { BaseSolver, PipelineStep } from "@tscircuit/solver-utils"
import { GapFill } from "lib/solvers/BgaTopologyGeneratorSolver/GapFill"
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

  initialTopologySolver!: InitialBgaTopologySolver
  removeMeshNodeOverlppingWithUnmarkedObstacle!: RemoveMeshNodeOverlppingWithUnmarkedObstacle
  gapfillDueToNodeRemoval!: GapFill
  markedComponentObstacles: Obstacle[] = []
  unmarkedComponentObstacles: Obstacle[] = []

  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "initialTopologySolver",
      InitialBgaTopologySolver,
      (bgaTopologyGeneratorSolver: BgaTopologyGeneratorSolver) => [
        {
          srj: bgaTopologyGeneratorSolver.inputProblem.inputSrj,
          componentBounds:
            bgaTopologyGeneratorSolver.inputProblem.detectedComponent.bounds,
          componentId:
            bgaTopologyGeneratorSolver.inputProblem.detectedComponent.componentId,
          markedComponentObstacles:
            bgaTopologyGeneratorSolver.markedComponentObstacles,
          unmarkedComponentObstacles:
            bgaTopologyGeneratorSolver.unmarkedComponentObstacles,
        },
      ],
    ),
    definePipelineStep(
      "removeMeshNodeOverlppingWithUnmarkedObstacle",
      RemoveMeshNodeOverlppingWithUnmarkedObstacle,
      (bgaTopologyGeneratorSolver: BgaTopologyGeneratorSolver) => [
        {
          meshNodes: bgaTopologyGeneratorSolver.initialTopologySolver.getOutput(),
          obstacles: bgaTopologyGeneratorSolver.unmarkedComponentObstacles,
          layerCount:
            bgaTopologyGeneratorSolver.inputProblem.inputSrj.layerCount,
        },
      ],
    ),
    definePipelineStep(
      "gapfillDueToNodeRemoval",
      GapFill,
      (bgaTopologyGeneratorSolver: BgaTopologyGeneratorSolver) => [
        {
          meshNodes:
            bgaTopologyGeneratorSolver.removeMeshNodeOverlppingWithUnmarkedObstacle.getOutput(),
          unmarkedComponentObstacles:
            bgaTopologyGeneratorSolver.unmarkedComponentObstacles,
          layerCount:
            bgaTopologyGeneratorSolver.inputProblem.inputSrj.layerCount,
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
      const obstacleBounds = getBoundFromCenteredRect(obstacle)

      if (!doBoundsOverlap(componentBounds, obstacleBounds)) {
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
      this.gapfillDueToNodeRemoval?.getOutput() ??
      this.removeMeshNodeOverlppingWithUnmarkedObstacle?.getOutput() ??
      []

    return {
      routingRegions,
    }
  }
}

TopologyGenerator.register(BgaTopologyGeneratorSolver)
