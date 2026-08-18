import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import {
  GlobalDrcBranchPortfolioSolver,
  type GlobalDrcBranchPortfolioSolverParams,
  type HighDensityRoute,
} from "high-density-repair03/lib"

type AdaptivePortfolioPhase = "start" | "fastProbe" | "fallback" | "done"

/**
 * Tries Pipeline7's inexpensive two-layer repair portfolio first, then accepts
 * it only when the same DRC evaluator used for candidate scoring reports a
 * clean result. Failed probes are discarded before the original full
 * portfolio runs, so routing behavior is selected by the result rather than
 * board-size thresholds.
 */
export class Pipeline7AdaptiveDrcBranchPortfolioSolver extends BaseSolver {
  readonly params: GlobalDrcBranchPortfolioSolverParams
  readonly inputHdRoutes: HighDensityRoute[]
  outputHdRoutes: HighDensityRoute[]

  private phase: AdaptivePortfolioPhase = "start"
  private fastProbeSolver?: GlobalDrcBranchPortfolioSolver
  private fallbackSolver?: GlobalDrcBranchPortfolioSolver
  private selectedSolver?: GlobalDrcBranchPortfolioSolver
  private fastProbeDrcIssueCount?: number
  private fastProbeNonViaPadDrcIssueCount?: number
  private fastProbeAttempted = false

  constructor(params: GlobalDrcBranchPortfolioSolverParams) {
    super()
    this.params = params
    this.inputHdRoutes = params.hdRoutes
    this.outputHdRoutes = params.hdRoutes
  }

  override getConstructorParams(): [GlobalDrcBranchPortfolioSolverParams] {
    return [
      {
        ...this.params,
        hdRoutes: this.inputHdRoutes,
      },
    ]
  }

  private startFastProbe() {
    this.fastProbeAttempted = true
    this.fastProbeSolver = new GlobalDrcBranchPortfolioSolver({
      ...this.params,
      hdRoutes: this.inputHdRoutes,
      maxIterations: 4,
      broadPassMultiplier: 0.1,
    })
    this.activeSubSolver = this.fastProbeSolver
    this.phase = "fastProbe"
  }

  private startFallback() {
    this.fallbackSolver = new GlobalDrcBranchPortfolioSolver({
      ...this.params,
      hdRoutes: this.inputHdRoutes,
    })
    this.activeSubSolver = this.fallbackSolver
    this.phase = "fallback"
  }

  private evaluateFastProbeDrcIssueCount(routes: HighDensityRoute[]) {
    // The selected portfolio branch already evaluated its final routes with
    // this DRC evaluator. Reuse that result instead of repeating a full pass.
    const solverReportedCount = this.fastProbeSolver?.stats.finalDrcIssueCount
    if (
      typeof solverReportedCount === "number" &&
      Number.isFinite(solverReportedCount) &&
      solverReportedCount >= 0
    ) {
      return solverReportedCount
    }

    const result = this.params.drcEvaluator?.({
      traces: [],
      srj: this.params.srj,
      routes,
      hdRoutes: routes,
    })
    if (!result) return undefined
    return Array.isArray(result) ? result.length : result.errors.length
  }

  private finish(
    solver: GlobalDrcBranchPortfolioSolver,
    fastProbeAccepted: boolean,
  ) {
    this.outputHdRoutes = solver.getOutput()
    this.selectedSolver = solver
    this.activeSubSolver = null
    this.phase = "done"
    this.progress = 1
    this.stats = {
      ...solver.stats,
      pipeline7AdaptiveExactDrcFastProbeAttempted: this.fastProbeAttempted,
      pipeline7AdaptiveExactDrcFastProbeAccepted: fastProbeAccepted,
      pipeline7AdaptiveExactDrcFastProbeDrcIssueCount:
        this.fastProbeDrcIssueCount,
      pipeline7AdaptiveExactDrcFastProbeNonViaPadDrcIssueCount:
        this.fastProbeNonViaPadDrcIssueCount,
    }
    this.solved = true
  }

  override _step() {
    if (this.phase === "start") {
      if (
        this.params.srj.layerCount === 2 &&
        this.params.enableSafeTraceLayerMoves
      ) {
        this.startFastProbe()
      } else {
        this.startFallback()
      }
      return
    }

    if (this.phase === "fastProbe") {
      try {
        this.fastProbeSolver!.step()
      } catch {
        this.startFallback()
        return
      }
      if (this.fastProbeSolver!.failed) {
        this.startFallback()
        return
      }
      if (!this.fastProbeSolver!.solved) return

      const fastProbeRoutes = this.fastProbeSolver!.getOutput()
      try {
        this.fastProbeDrcIssueCount =
          this.evaluateFastProbeDrcIssueCount(fastProbeRoutes)
        const solverReportedNonViaPadCount =
          this.fastProbeSolver!.stats
            .drcBranchPortfolioFinalNonViaPadDrcIssueCount
        this.fastProbeNonViaPadDrcIssueCount =
          typeof solverReportedNonViaPadCount === "number"
            ? solverReportedNonViaPadCount
            : this.fastProbeDrcIssueCount
      } catch {
        this.startFallback()
        return
      }
      if (this.fastProbeNonViaPadDrcIssueCount === 0) {
        this.finish(this.fastProbeSolver!, true)
      } else {
        this.startFallback()
      }
      return
    }

    if (this.phase === "fallback") {
      this.fallbackSolver!.step()
      if (this.fallbackSolver!.failed) {
        throw new Error(
          `Pipeline7 full DRC repair portfolio failed: ${this.fallbackSolver!.error}`,
        )
      }
      if (this.fallbackSolver!.solved) {
        this.finish(this.fallbackSolver!, false)
      }
    }
  }

  override getOutput() {
    return this.outputHdRoutes
  }

  override visualize(): GraphicsObject {
    const visualizer = this.activeSubSolver ?? this.selectedSolver
    return visualizer?.visualize() ?? super.visualize()
  }

  override preview(): GraphicsObject {
    const visualizer = this.activeSubSolver ?? this.selectedSolver
    return visualizer?.preview() ?? this.visualize()
  }
}
