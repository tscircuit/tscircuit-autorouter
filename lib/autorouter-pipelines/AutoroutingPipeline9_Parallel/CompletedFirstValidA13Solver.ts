import { BaseSolver } from "../../solvers/BaseSolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../../types/high-density-types"
import type { FirstValidA13CandidateResult } from "./firstValidA13CandidateTypes"

/** A completed winner exposes routes to the original portfolio metadata repair. */
export class CompletedFirstValidA13Solver extends BaseSolver {
  readonly nodeWithPortPoints: NodeWithPortPoints
  readonly solvedRoutes: HighDensityIntraNodeRoute[]
  readonly hyperParameters = { HIGH_DENSITY_A13: true, SHUFFLE_SEED: 0 }
  readonly routingIterations: number

  constructor(node: NodeWithPortPoints, result: FirstValidA13CandidateResult) {
    super()
    if (result.status === "exception") {
      const error = new Error(result.exception.message)
      error.name = result.exception.name
      throw error
    }
    if (result.status !== "solved") throw new Error(`Cannot materialize an A13 candidate with status ${result.status}`)
    this.nodeWithPortPoints = node
    this.solvedRoutes = result.routes
    this.iterations = result.iterations
    this.MAX_ITERATIONS = result.maxIterations
    this.routingIterations = result.routingIterations
    this.stats = result.sourceStats
    this.solved = true
    this.progress = 1
  }
}
