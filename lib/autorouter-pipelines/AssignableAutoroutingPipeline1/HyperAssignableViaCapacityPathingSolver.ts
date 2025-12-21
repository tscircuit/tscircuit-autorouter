import { HyperParameterSupervisorSolver } from "lib/solvers/HyperParameterSupervisorSolver"
import type { CapacityHyperParameters } from "lib/solvers/CapacityHyperParameters"
import { AssignableViaCapacityPathingSolver_DirectiveSubOptimal } from "./AssignableViaCapacityPathing/AssignableViaCapacityPathingSolver_DirectiveSubOptimal"

export type AssignableViaCapacityPathingParams = ConstructorParameters<
  typeof AssignableViaCapacityPathingSolver_DirectiveSubOptimal
>[0]

type HyperParameterOverrides = Partial<CapacityHyperParameters> & {
  TRACE_ORDERING_SEED?: number
  LAYER_TRAVERSAL_REWARD?: number
}

export class HyperAssignableViaCapacityPathingSolver extends HyperParameterSupervisorSolver<AssignableViaCapacityPathingSolver_DirectiveSubOptimal> {
  constructorParams: AssignableViaCapacityPathingParams

  constructor(opts: AssignableViaCapacityPathingParams) {
    super()
    this.constructorParams = opts
    this.MAX_ITERATIONS = opts.MAX_ITERATIONS ?? 120_000
    this.MIN_SUBSTEPS = 5
    this.GREEDY_MULTIPLIER = 1.35
  }

  getHyperParameterDefs() {
    return [
      {
        name: "traceOrderingSeed",
        possibleValues: [
          { SHUFFLE_SEED: 0 },
          { SHUFFLE_SEED: 1 },
          { SHUFFLE_SEED: 2 },
          { SHUFFLE_SEED: 3 },
          { SHUFFLE_SEED: 4 },
          { SHUFFLE_SEED: 5 },
          { SHUFFLE_SEED: 6 },
          { SHUFFLE_SEED: 7 },
          { SHUFFLE_SEED: 8 },
          { SHUFFLE_SEED: 9 },
        ],
      },
      {
        name: "forceViaTravelChance",
        possibleValues: [
          { FORCE_VIA_TRAVEL_CHANCE: 0.6 },
          { FORCE_VIA_TRAVEL_CHANCE: 0.8 },
          { FORCE_VIA_TRAVEL_CHANCE: 0.9 },
        ],
      },
    ]
  }

  computeG(solver: AssignableViaCapacityPathingSolver_DirectiveSubOptimal) {
    const totalConnections =
      solver.unprocessedConnectionPairs.length +
      solver.solvedRoutes.length +
      (solver.activeConnectionPair ? 1 : 0)
    const solvedConnections = solver.solvedRoutes.length
    const solvedRatio =
      totalConnections > 0 ? solvedConnections / totalConnections : 0

    return solver.iterations / solver.MAX_ITERATIONS + (1 - solvedRatio)
  }

  computeH(solver: AssignableViaCapacityPathingSolver_DirectiveSubOptimal) {
    const totalConnections =
      solver.unprocessedConnectionPairs.length +
      solver.solvedRoutes.length +
      (solver.activeConnectionPair ? 1 : 0)
    const solvedConnections = solver.solvedRoutes.length
    const remainingRatio =
      totalConnections > 0 ? 1 - solvedConnections / totalConnections : 0

    return remainingRatio
  }

  generateSolver(hyperParameters: HyperParameterOverrides) {
    return new AssignableViaCapacityPathingSolver_DirectiveSubOptimal({
      ...this.constructorParams,
      hyperParameters: {
        ...this.constructorParams.hyperParameters,
        ...hyperParameters,
      },
    })
  }
}
