import { BaseSolver } from "../BaseSolver"
import {
  HyperParameterDef,
  HyperParameterSupervisorSolver,
  SupervisedSolver,
} from "../HyperParameterSupervisorSolver"
import {
  CapacityPathingSingleSectionPathingSolver,
  CapacityPathingSingleSectionPathingSolverParams,
} from "./CapacityPathingSingleSectionSolver"

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

export class HyperCapacityPathingSingleSectionSolver extends HyperParameterSupervisorSolver<CapacityPathingSingleSectionPathingSolver> {
  override getSolverName(): string {
    return "HyperCapacityPathingSingleSectionSolver"
  }

  constructorParams: CapacityPathingSingleSectionPathingSolverParams

  declare winningSolver?: CapacityPathingSingleSectionPathingSolver

  constructor(
    params: ConstructorParameters<
      typeof CapacityPathingSingleSectionPathingSolver
    >[0],
  ) {
    super()
    this.MAX_ITERATIONS = 100e3
    this.constructorParams = params
  }

  // TODO this needs to use the section score, ideally incorporating the current best candidate
  // of the paths being explored inside the single section
  computeG(solver: CapacityPathingSingleSectionPathingSolver): number {
    // return solver.iterations / 100
    return -solver.getSolvedSectionScore()
  }

  computeH(solver: CapacityPathingSingleSectionPathingSolver): number {
    return 0
    // return solver.computeProgress()
  }

  getCombinationDefs(): Array<Array<string>> | null {
    // TODO change combination defs based on hyperParameters.EXPANSION_DEGREES
    const numConnections =
      this.constructorParams.sectionConnectionTerminals.length

    if (numConnections === 2) {
      return [["orderings2_for2"]]
    } else if (numConnections === 3) {
      return [["orderings6_for3"]]
    } else if (numConnections === 4) {
      return [["orderings24_for4"]]
    }
    return [["orderings30"]]
  }

  getFailureMessage() {
    return `All CapacityPathingSingleSection solvers failed for "${this.centerNodeId}"`
  }

  getHyperParameterDefs(): Array<HyperParameterDef> {
    return [
      {
        name: "orderings2_for2",
        possibleValues: range(2).map((i) => ({
          SHUFFLE_SEED: i,
        })),
      },
      {
        name: "orderings6_for3",
        possibleValues: range(6).map((i) => ({
          SHUFFLE_SEED: i,
        })),
      },
      {
        name: "orderings24_for4",
        possibleValues: range(24).map((i) => ({
          SHUFFLE_SEED: i,
        })),
      },
      {
        name: "orderings30",
        possibleValues: range(30).map((i) => ({
          SHUFFLE_SEED: i,
        })),
      },
    ]
  }

  generateSolver(
    hyperParameters: any,
  ): CapacityPathingSingleSectionPathingSolver {
    return new CapacityPathingSingleSectionPathingSolver({
      ...this.constructorParams,
      hyperParameters: {
        ...this.constructorParams.hyperParameters,
        ...hyperParameters,
      },
    })
  }

  onSolve({
    solver,
  }: SupervisedSolver<CapacityPathingSingleSectionPathingSolver>) {
    this.winningSolver = solver
  }

  get centerNodeId() {
    return this.constructorParams.centerNodeId
  }

  get sectionNodes() {
    return this.constructorParams.sectionNodes
  }

  get sectionConnectionTerminals() {
    return this.winningSolver?.sectionConnectionTerminals
  }
}
