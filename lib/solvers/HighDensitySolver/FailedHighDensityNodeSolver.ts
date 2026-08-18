import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import { BaseSolver } from "../BaseSolver"

/** Host-side view of a failed solver whose original instance lived in a worker. */
export class FailedHighDensityNodeSolver extends BaseSolver {
  readonly nodeWithPortPoints: NodeWithPortPoints
  readonly solvedRoutes: HighDensityIntraNodeRoute[]
  private readonly solverType: string

  constructor({
    nodeWithPortPoints,
    solvedRoutes,
    solverType,
    iterations,
    error,
  }: {
    nodeWithPortPoints: NodeWithPortPoints
    solvedRoutes: HighDensityIntraNodeRoute[]
    solverType: string
    iterations: number
    error?: string
  }) {
    super()
    this.nodeWithPortPoints = nodeWithPortPoints
    this.solvedRoutes = solvedRoutes
    this.solverType = solverType
    this.iterations = iterations
    this.error = error ?? null
    this.failed = true
  }

  override getSolverName(): string {
    return this.solverType
  }
}
