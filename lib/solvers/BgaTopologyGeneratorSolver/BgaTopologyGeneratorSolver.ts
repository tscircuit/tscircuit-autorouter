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

export class BgaTopologyGeneratorSolver extends BasePipelineSolver<any> {
  static readonly componentKind = "bga"
  initialTopologySolver!: InitialBgaTopologySolver

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
  ]

  constructor(public readonly inputProblem: TopologyGeneratorSolverParams) {
    super(inputProblem)
  }

  override getConstructorParams(): readonly [TopologyGeneratorSolverParams] {
    return [this.inputProblem] as const
  }

  getOutput(): TopologyGeneratorSolverOutput {
    return this.initialTopologySolver.getOutput()
  }
}

TopologyGenerator.register(BgaTopologyGeneratorSolver)
