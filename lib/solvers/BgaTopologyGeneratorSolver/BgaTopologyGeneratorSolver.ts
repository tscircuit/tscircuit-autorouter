import {
  doBoundsOverlap,
  getBoundFromCenteredRect,
} from "@tscircuit/math-utils"
import { BasePipelineSolver, definePipelineStep } from "@tscircuit/solver-utils"
import type { BaseSolver, PipelineStep } from "@tscircuit/solver-utils"
import { InitialBgaTopologySolver } from "lib/solvers/BgaTopologyGeneratorSolver/InitialBgaTopologySolver"
import { RemoveMeshNodeOverlappingSolver } from "lib/solvers/BgaTopologyGeneratorSolver/RemoveMeshNodeOverlappingSolver"
import {
  TopologyGenerator,
  type TopologyGeneratorSolverOutput,
  type TopologyGeneratorSolverParams,
} from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import type { CapacityMeshNode } from "lib/types"

export class BgaTopologyGeneratorSolver extends BasePipelineSolver<TopologyGeneratorSolverParams> {
  static readonly componentKind = "bga"
  initialTopologySolver?: InitialBgaTopologySolver
  mergeObstacleMeshNodes?: RemoveMeshNodeOverlappingSolver

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
        },
      ],
    ),
    definePipelineStep(
      "mergeObstacleMeshNodes",
      RemoveMeshNodeOverlappingSolver,
      (solverInstance: BgaTopologyGeneratorSolver) => [
        {
          meshNodes:
            solverInstance.initialTopologySolver?.getOutput().routingRegions ??
            [],
          obstacles: solverInstance.inputProblem.inputSrj.obstacles.filter(
            (obstacle) =>
              doBoundsOverlap(
                solverInstance.inputProblem.detectedComponent.bounds,
                getBoundFromCenteredRect(obstacle),
              ) &&
              obstacle.componentId !==
                solverInstance.inputProblem.detectedComponent.componentId,
          ),
          layerCount: solverInstance.inputProblem.inputSrj.layerCount,
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

  override getOutput(): TopologyGeneratorSolverOutput {
    const routingRegions: CapacityMeshNode[] =
      this.mergeObstacleMeshNodes?.getOutput() ?? []

    return {
      routingRegions,
    }
  }
}

TopologyGenerator.register(BgaTopologyGeneratorSolver)
