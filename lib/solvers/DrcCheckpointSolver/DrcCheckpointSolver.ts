import type { DrcEvaluator } from "high-density-repair03/lib"
import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"

type DrcCheckpointSolverParams = {
  baselineHdRoutes: HighDensityRoute[]
  candidateHdRoutes: HighDensityRoute[]
  drcEvaluator: DrcEvaluator
}

const countDrcErrors = (
  evaluator: DrcEvaluator,
  routes: HighDensityRoute[],
): number => {
  const result = evaluator({ routes, traces: [] })
  return Array.isArray(result) ? result.length : result.errors.length
}

export class DrcCheckpointSolver extends BaseSolver {
  readonly params: DrcCheckpointSolverParams
  outputHdRoutes: HighDensityRoute[]

  constructor(params: DrcCheckpointSolverParams) {
    super()
    this.params = params
    this.outputHdRoutes = params.baselineHdRoutes
    this.MAX_ITERATIONS = 1
  }

  override getSolverName(): string {
    return "DrcCheckpointSolver"
  }

  override getConstructorParams(): readonly [DrcCheckpointSolverParams] {
    return [this.params]
  }

  override _step(): void {
    const baselineDrcCount = countDrcErrors(
      this.params.drcEvaluator,
      this.params.baselineHdRoutes,
    )
    const candidateDrcCount = countDrcErrors(
      this.params.drcEvaluator,
      this.params.candidateHdRoutes,
    )
    const accepted = candidateDrcCount <= baselineDrcCount

    this.outputHdRoutes = accepted
      ? this.params.candidateHdRoutes
      : this.params.baselineHdRoutes
    this.stats = {
      baselineDrcCount,
      candidateDrcCount,
      accepted,
    }
    this.solved = true
    this.progress = 1
  }

  getOutput(): HighDensityRoute[] {
    return this.outputHdRoutes
  }

  override visualize(): GraphicsObject {
    return { lines: [], points: [], rects: [], circles: [] }
  }
}
