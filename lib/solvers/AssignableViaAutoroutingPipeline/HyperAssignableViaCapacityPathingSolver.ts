import { HyperParameterSupervisorSolver } from "lib/solvers/HyperParameterSupervisorSolver"
import type { CapacityHyperParameters } from "lib/solvers/CapacityHyperParameters"
import { AssignableViaCapacityPathingGreedySolver } from "./AssignableViaCapacityPathingGreedySolver"

export type AssignableViaCapacityPathingParams = ConstructorParameters<
  typeof AssignableViaCapacityPathingGreedySolver
>[0]

type HyperParameterOverrides = Partial<CapacityHyperParameters> & {
  TRACE_ORDERING_SEED?: number
  LAYER_TRAVERSAL_REWARD?: number
}

export class HyperAssignableViaCapacityPathingSolver extends HyperParameterSupervisorSolver<AssignableViaCapacityPathingGreedySolver> {
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
          { TRACE_ORDERING_SEED: 0 },
          // { TRACE_ORDERING_SEED: 1 },
          // { TRACE_ORDERING_SEED: 2 },
          // { TRACE_ORDERING_SEED: 3 },
          // { TRACE_ORDERING_SEED: 4 },
          // { TRACE_ORDERING_SEED: 5 },
          // { TRACE_ORDERING_SEED: 6 },
          // { TRACE_ORDERING_SEED: 7 },
          // { TRACE_ORDERING_SEED: 8 },
          // { TRACE_ORDERING_SEED: 9 },
        ],
      },
      // {
      //   name: "layerTraversalReward",
      //   possibleValues: [
      //     { LAYER_TRAVERSAL_REWARD: 0.7 },
      //     { LAYER_TRAVERSAL_REWARD: 1 },
      //   ],
      // },
    ]
  }

  computeG(solver: AssignableViaCapacityPathingGreedySolver) {
    const totalConnections = solver.connectionsWithNodes.length || 1
    const solvedConnections = solver.connectionsWithNodes.filter(
      (connection) => connection.path?.length,
    ).length
    const solvedRatio = solvedConnections / totalConnections

    return solver.iterations / solver.MAX_ITERATIONS + (1 - solvedRatio)
  }

  computeH(solver: AssignableViaCapacityPathingGreedySolver) {
    const totalConnections = solver.connectionsWithNodes.length || 1
    const solvedConnections = solver.connectionsWithNodes.filter(
      (connection) => connection.path?.length,
    ).length
    const remainingRatio = 1 - solvedConnections / totalConnections

    return remainingRatio
  }

  generateSolver(hyperParameters: HyperParameterOverrides) {
    return new AssignableViaCapacityPathingGreedySolver({
      ...this.constructorParams,
      hyperParameters: {
        ...this.constructorParams.hyperParameters,
        ...hyperParameters,
      },
    })
  }
}
