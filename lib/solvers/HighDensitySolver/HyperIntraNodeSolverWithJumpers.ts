import type {
  HighDensityIntraNodeRouteWithJumpers,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { IntraNodeSolverWithJumpers } from "./IntraNodeSolverWithJumpers"
import {
  HyperParameterSupervisorSolver,
  SupervisedSolver,
} from "../HyperParameterSupervisorSolver"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityHyperParameters } from "./HighDensityHyperParameters"
import type { GraphicsObject } from "graphics-debug"
import {
  JumperPrepatternSolver,
  type JumperPrepatternSolverHyperParameters,
} from "../JumperPrepatternSolver/JumperPrepatternSolver"
import { BaseSolver } from "../BaseSolver"

type JumperSolver = IntraNodeSolverWithJumpers | JumperPrepatternSolver

export class HyperIntraNodeSolverWithJumpers extends HyperParameterSupervisorSolver<JumperSolver> {
  constructorParams: ConstructorParameters<typeof IntraNodeSolverWithJumpers>[0]
  solvedRoutes: HighDensityIntraNodeRouteWithJumpers[] = []
  nodeWithPortPoints: NodeWithPortPoints
  connMap?: ConnectivityMap

  constructor(
    opts: ConstructorParameters<typeof IntraNodeSolverWithJumpers>[0],
  ) {
    super()
    this.nodeWithPortPoints = opts.nodeWithPortPoints
    this.connMap = opts.connMap
    this.constructorParams = opts
    this.MAX_ITERATIONS = 250_000
    this.GREEDY_MULTIPLIER = 5
    this.MIN_SUBSTEPS = 100
  }

  getHyperParameterDefs() {
    return [
      {
        name: "orderings20",
        possibleValues: Array.from({ length: 20 }, (_, i) => ({
          SHUFFLE_SEED: i,
        })),
      },
      {
        name: "jumperPrepattern",
        possibleValues: [
          {
            USE_JUMPER_PREPATTERN: true,
            FIRST_ORIENTATION: "horizontal",
            PATTERN_TYPE: "alternating_grid",
          },
          {
            USE_JUMPER_PREPATTERN: true,
            FIRST_ORIENTATION: "vertical",
            PATTERN_TYPE: "alternating_grid",
          },
          {
            USE_JUMPER_PREPATTERN: true,
            FIRST_ORIENTATION: "horizontal",
            PATTERN_TYPE: "staggered_grid",
          },
          {
            USE_JUMPER_PREPATTERN: true,
            FIRST_ORIENTATION: "vertical",
            PATTERN_TYPE: "staggered_grid",
          },
        ] as Array<
          {
            USE_JUMPER_PREPATTERN: true
          } & JumperPrepatternSolverHyperParameters
        >,
      },
    ]
  }

  getCombinationDefs() {
    return [
      // Try JumperPrepatternSolver first (tends to produce better results for complex patterns)
      ["jumperPrepattern"],
      // Fall back to IntraNodeSolverWithJumpers with various orderings
      ["orderings20"],
    ]
  }

  _step() {
    super._step()
    this.stats.bestFitnessHyperParameters =
      this.getSupervisedSolverWithBestFitness()?.hyperParameters
  }

  computeG(solver: JumperSolver) {
    if ("USE_JUMPER_PREPATTERN" in (solver as any).hyperParameters) {
      // Give prepattern solver a slight advantage to try it first
      return 500 + solver.iterations / 10_000
    }
    return solver.iterations / 10_000
  }

  computeH(solver: JumperSolver) {
    return 1 - (solver.progress || 0)
  }

  generateSolver(
    hyperParameters: Partial<HighDensityHyperParameters> & {
      USE_JUMPER_PREPATTERN?: boolean
      FIRST_ORIENTATION?: "horizontal" | "vertical"
      PATTERN_TYPE?: "alternating_grid" | "staggered_grid"
    },
  ): JumperSolver {
    if (hyperParameters.USE_JUMPER_PREPATTERN) {
      const prepatternSolver = new JumperPrepatternSolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        colorMap: this.constructorParams.colorMap,
        connMap: this.connMap,
        traceWidth: this.constructorParams.traceWidth,
        hyperParameters: {
          FIRST_ORIENTATION: hyperParameters.FIRST_ORIENTATION,
          PATTERN_TYPE: hyperParameters.PATTERN_TYPE,
        },
      })
      // Store hyperParameters on the solver for computeG reference
      ;(prepatternSolver as any).hyperParameters = hyperParameters
      return prepatternSolver as JumperSolver
    }

    return new IntraNodeSolverWithJumpers({
      ...this.constructorParams,
      hyperParameters: {
        ...this.constructorParams.hyperParameters,
        ...hyperParameters,
      },
    })
  }

  onSolve(solver: SupervisedSolver<JumperSolver>) {
    if (solver.solver instanceof JumperPrepatternSolver) {
      this.solvedRoutes = solver.solver.getOutput()
    } else {
      this.solvedRoutes = (
        solver.solver as IntraNodeSolverWithJumpers
      ).solvedRoutes
    }
  }

  visualize(): GraphicsObject {
    // Use winning solver if available, otherwise fall back to best fitness solver
    if (this.winningSolver) {
      return this.winningSolver.visualize()
    }
    if (this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }
    return super.visualize()
  }
}
