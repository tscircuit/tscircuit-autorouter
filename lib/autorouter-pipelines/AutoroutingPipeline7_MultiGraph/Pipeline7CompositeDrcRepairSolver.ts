import type { GraphicsObject } from "graphics-debug"
import {
  type DrcEvaluator,
  GlobalDrcBranchPortfolioSolver,
  type GlobalDrcBranchPortfolioSolverParams,
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
} from "high-density-repair03/lib"
import type { SimpleRouteConnection } from "lib/types"
import { applyPipeline7TerminalViaRelocations } from "./applyPipeline7TerminalViaRelocations"

type CompositeRepairPhase = "portfolio" | "safeTraceLayer" | "done"

const isViaToPadError = (error: Record<string, unknown>) =>
  (error.type ?? error.error_type) === "pcb_pad_pad_clearance_error" &&
  Array.isArray(error.pcb_via_ids) &&
  error.pcb_via_ids.length === 1

const getDrcErrors = (evaluator: DrcEvaluator, routes: HighDensityRoute[]) => {
  const result = evaluator({ traces: [], routes, hdRoutes: routes })
  return Array.isArray(result)
    ? result
    : (result.errorsWithCenters ?? result.errors)
}

const usesFinePitchPadClearance = (srj: {
  minTraceToPadEdgeClearance?: number
  minViaEdgeToPadEdgeClearance?: number
}) => {
  const traceClearance = srj.minTraceToPadEdgeClearance
  const viaClearance = srj.minViaEdgeToPadEdgeClearance
  return (
    typeof traceClearance === "number" &&
    typeof viaClearance === "number" &&
    Math.min(traceClearance, viaClearance) < 0.1 - 1e-9
  )
}

const createLegacyDrcEvaluator =
  (evaluator: DrcEvaluator): DrcEvaluator =>
  (input) => {
    const result = evaluator(input)
    const errors = Array.isArray(result) ? result : result.errors
    const errorsWithCenters = Array.isArray(result)
      ? result
      : (result.errorsWithCenters ?? result.errors)
    return {
      errors: errors.filter((error) => !isViaToPadError(error)),
      errorsWithCenters: errorsWithCenters.filter(
        (error) => !isViaToPadError(error),
      ),
    }
  }

/**
 * Extends Pipeline7's exact DRC portfolio with a guarded two-part terminal
 * escape repair: first move conflicting terminal spans to another layer, then
 * legalize any terminal vias that land beside neighboring fine-pitch pads.
 */
export class Pipeline7CompositeDrcRepairSolver extends GlobalDrcBranchPortfolioSolver {
  private readonly basePortfolioSolver: GlobalDrcBranchPortfolioSolver
  private readonly newConnections: SimpleRouteConnection[]
  private compositePhase: CompositeRepairPhase = "portfolio"
  private compositeSafeTraceLayerSolver?: GlobalDrcForceImproveSolver
  private outputRoutes: HighDensityRoute[]

  constructor(
    params: GlobalDrcBranchPortfolioSolverParams & {
      newConnections: SimpleRouteConnection[]
    },
  ) {
    super(params)
    this.newConnections = params.newConnections
    this.outputRoutes = params.hdRoutes
    this.basePortfolioSolver = new GlobalDrcBranchPortfolioSolver(params)
    this.activeSubSolver = this.basePortfolioSolver
    this.MAX_ITERATIONS =
      this.basePortfolioSolver.MAX_ITERATIONS +
      (params.viaInPadMaxIterations ?? params.maxIterations ?? 48) +
      3
  }

  private finish(
    routes: HighDensityRoute[],
    errors: Array<Record<string, unknown>>,
    stats: Record<string, unknown> = {},
  ) {
    this.outputRoutes = routes
    this.stats = {
      ...this.basePortfolioSolver.stats,
      ...stats,
      finalDrcIssueCount: errors.length,
    }
    this.activeSubSolver = null
    this.compositePhase = "done"
    this.progress = 1
    this.solved = true
  }

  override _step() {
    if (this.compositePhase === "portfolio") {
      this.basePortfolioSolver.step()
      this.progress = this.basePortfolioSolver.progress * 0.8
      if (this.basePortfolioSolver.failed) {
        this.failed = true
        this.error = this.basePortfolioSolver.error
        return
      }
      if (!this.basePortfolioSolver.solved) return

      const portfolioOutput = this.basePortfolioSolver.getOutput()
      const portfolioErrors = getDrcErrors(
        this.params.drcEvaluator!,
        portfolioOutput,
      )
      if (
        !this.params.enableSafeTraceLayerMoves ||
        portfolioErrors.length === 0 ||
        !usesFinePitchPadClearance(this.params.srj)
      ) {
        this.finish(portfolioOutput, portfolioErrors)
        return
      }

      this.compositeSafeTraceLayerSolver = new GlobalDrcForceImproveSolver({
        srj: this.params.srj,
        hdRoutes: portfolioOutput,
        connMap: this.params.connMap,
        effort: this.params.effort,
        viaHoleDiameter: this.params.viaHoleDiameter,
        drcEvaluator: createLegacyDrcEvaluator(this.params.drcEvaluator!),
        maxIterations:
          this.params.viaInPadMaxIterations ?? this.params.maxIterations,
        enableBroadFallback: false,
        enableLargeBoardBroadFallback: false,
        enableTargetedErrorSweep: false,
        enableTraceViaOwnerTargeting: this.params.enableTraceViaOwnerTargeting,
        enablePostSolveClearanceRelaxation: false,
        enableSafeTraceLayerMoves: true,
        enableViaInPadLayerMoves: false,
      })
      this.activeSubSolver = this.compositeSafeTraceLayerSolver
      this.compositePhase = "safeTraceLayer"
      return
    }

    if (this.compositePhase === "safeTraceLayer") {
      this.compositeSafeTraceLayerSolver!.step()
      this.progress = 0.8 + this.compositeSafeTraceLayerSolver!.progress * 0.2
      if (this.compositeSafeTraceLayerSolver!.failed) {
        this.failed = true
        this.error = this.compositeSafeTraceLayerSolver!.error
        return
      }
      if (!this.compositeSafeTraceLayerSolver!.solved) return

      const portfolioOutput = this.basePortfolioSolver.getOutput()
      const portfolioErrors = getDrcErrors(
        this.params.drcEvaluator!,
        portfolioOutput,
      )
      const safeTraceLayerOutput =
        this.compositeSafeTraceLayerSolver!.getOutput()
      const relocationResult = applyPipeline7TerminalViaRelocations({
        srj: this.params.srj,
        routes: safeTraceLayerOutput,
        newConnections: this.newConnections,
        drcEvaluator: this.params.drcEvaluator!,
      })
      // Keep the established Pipeline7 portfolio output unless this targeted
      // fallback removes at least one whole-board violation. An equal-count
      // clearance-score improvement is not enough to justify perturbing routes
      // that the original portfolio already selected.
      const accepted = relocationResult.errors.length < portfolioErrors.length
      this.finish(
        accepted ? relocationResult.routes : portfolioOutput,
        accepted ? relocationResult.errors : portfolioErrors,
        {
          drcBranchPortfolioSafeTraceLayerPhaseAttempted: true,
          drcBranchPortfolioSafeTraceLayerPhaseAccepted: accepted,
          pipeline7TerminalViaRelocationAttemptedCandidateCount:
            relocationResult.attemptedCandidateCount,
          pipeline7TerminalViaRelocationAcceptedCandidateCount:
            relocationResult.acceptedCandidateCount,
          drcBranchPortfolioFinalNonViaPadDrcIssueCount: (accepted
            ? relocationResult.errors
            : portfolioErrors
          ).filter((error) => !isViaToPadError(error)).length,
        },
      )
    }
  }

  override getOutput() {
    return this.outputRoutes
  }

  override visualize(): GraphicsObject {
    return (
      this.activeSubSolver?.visualize() ??
      this.compositeSafeTraceLayerSolver?.visualize() ??
      this.basePortfolioSolver.visualize()
    )
  }
}
