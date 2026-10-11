/**
 * Exact asynchronous prototype derivative of high-density-repair03 at
 * e16df6c48efed49406cf45df49fd933d3141973d (MIT; see ./LICENSE).
 * Native branch selection, reference guards and work limits remain unchanged.
 */
import type { GraphicsObject } from "graphics-debug"
import type { PendingEffect } from "../../../solvers/BaseSolver"
import type { ParallelGlobalDrcTrialCoordinator } from "../parallelGlobalDrcTrialTypes"
import { BaseSolver } from "high-density-repair03/lib/solvers/BaseSolver"
import { AutoroutingDrcEngine } from "high-density-repair03/lib/drc"
import type { HighDensityRoute } from "high-density-repair03/lib/types/high-density-types"
import { ParallelGlobalDrcForceImproveSolver as GlobalDrcForceImproveSolver } from "./ParallelGlobalDrcForceImproveSolver"
import { RELAXED_DRC_OPTIONS } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/drcPresets"
import { getDrcSnapshot } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/drc-snapshot"
import {
  applyBroadRepulsionForces,
  cloneRoutes,
  getNonViaPadDrcIssueCount,
  hasNewDrcErrorIdentities,
  getViaDrcIssueCount,
  isBetterDrcSnapshot,
  isDrcSnapshotCountBetter,
  isViaPadDrcError,
  materializeRoutes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type {
  DrcEvaluator,
  DrcSnapshot,
  GlobalDrcBranchPortfolioSolverParams,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/types"

type PortfolioPhase =
  | "start"
  | "baseline"
  | "broad"
  | "safeTraceLayer"
  | "mixedSafeTraceLayer"
  | "viaInPad"
  | "done"

type PortfolioCandidate = {
  routes: HighDensityRoute[]
  snapshot: DrcSnapshot
  solver?: GlobalDrcForceImproveSolver
  safeTraceLayerPhaseAccepted: boolean
}

const LOW_COUNT_SAFE_TRACE_LAYER_MAX_DRC_ISSUES = 3

export class ParallelGlobalDrcBranchPortfolioSolver extends BaseSolver {
  readonly coordinator: ParallelGlobalDrcTrialCoordinator
  pendingEffects: PendingEffect[] = []
  private launched = false
  readonly params: GlobalDrcBranchPortfolioSolverParams
  readonly inputHdRoutes: HighDensityRoute[]
  readonly guardedInputHdRoutes: HighDensityRoute[]
  readonly broadMaxIterations: number
  readonly broadPassMultiplier: number
  readonly autoroutingDrcEngine?: AutoroutingDrcEngine
  readonly legacyDrcEvaluator: DrcEvaluator
  outputHdRoutes: HighDensityRoute[]
  private phase: PortfolioPhase = "start"
  private inputSnapshot?: DrcSnapshot
  private baselineSolver?: GlobalDrcForceImproveSolver
  private baselineSnapshot?: DrcSnapshot
  private broadInputSnapshot?: DrcSnapshot
  private broadSnapshot?: DrcSnapshot
  private broadSolver?: GlobalDrcForceImproveSolver
  private preBroadCandidate?: PortfolioCandidate
  private safeTraceLayerInputRoutes?: HighDensityRoute[]
  private safeTraceLayerInputSnapshot?: DrcSnapshot
  private safeTraceLayerSolver?: GlobalDrcForceImproveSolver
  private safeTraceLayerPhaseAccepted = false
  private mixedSafeTraceLayerSolver?: GlobalDrcForceImproveSolver
  private mixedSafeTraceLayerPhaseAccepted = false
  private legacySafeTraceLayerRoutes?: HighDensityRoute[]
  private legacySafeTraceLayerSnapshot?: DrcSnapshot
  private legacySafeTraceLayerSelectedSolver?: GlobalDrcForceImproveSolver
  private viaInPadSolver?: GlobalDrcForceImproveSolver
  private portfolioSelectedSolver?: GlobalDrcForceImproveSolver
  private selectedSolver?: GlobalDrcForceImproveSolver
  private referenceInputDrcIssueCount?: number
  private referenceCandidateDrcIssueCount?: number
  private referenceCandidateRolledBack = false
  private mixedReferenceInputDrcIssueCount?: number
  private mixedReferenceCandidateDrcIssueCount?: number
  private referenceInputSnapshot?: {
    errors: Array<Record<string, unknown>>
    count: number
  }

  constructor(params: GlobalDrcBranchPortfolioSolverParams, coordinator: ParallelGlobalDrcTrialCoordinator) {
    super()
    this.coordinator = coordinator
    if (!Number.isFinite(params.broadPassMultiplier)) {
      throw new Error("broadPassMultiplier must be a finite number")
    }
    if (params.broadPassMultiplier <= 0) {
      throw new Error("broadPassMultiplier must be greater than zero")
    }
    if (!Number.isInteger(params.broadMaxIterations)) {
      throw new Error("broadMaxIterations must be an integer")
    }
    if (params.broadMaxIterations <= 0) {
      throw new Error("broadMaxIterations must be greater than zero")
    }
    if (
      params.viaInPadMaxIterations !== undefined &&
      !Number.isInteger(params.viaInPadMaxIterations)
    ) {
      throw new Error("viaInPadMaxIterations must be an integer")
    }
    if (
      params.viaInPadMaxIterations !== undefined &&
      params.viaInPadMaxIterations <= 0
    ) {
      throw new Error("viaInPadMaxIterations must be greater than zero")
    }
    this.autoroutingDrcEngine =
      params.autoroutingDrcEngine ??
      (params.drcEvaluator
        ? undefined
        : new AutoroutingDrcEngine(params.srj, {
            connMap: params.connMap,
            traceClearance:
              params.srj.minTraceToPadEdgeClearance ??
              RELAXED_DRC_OPTIONS.traceClearance,
            viaClearance:
              params.srj.minTraceToPadEdgeClearance ??
              RELAXED_DRC_OPTIONS.viaClearance,
            includeTraceViaOwnerMetadata:
              params.enableTraceViaOwnerTargeting ?? false,
          }))
    this.legacyDrcEvaluator = (input) => {
      const stagedLegacyEvaluator =
        params.drcEvaluator?.evaluateLegacy ?? params.drcEvaluator
      const result = stagedLegacyEvaluator
        ? stagedLegacyEvaluator(input)
        : this.autoroutingDrcEngine!.evaluateLegacy(input.traces)
      const errors = Array.isArray(result) ? result : result.errors
      const errorsWithCenters = Array.isArray(result)
        ? result
        : (result.errorsWithCenters ?? result.errors)

      return {
        errors: errors.filter((error) => !isViaPadDrcError(error)),
        errorsWithCenters: errorsWithCenters.filter(
          (error) => !isViaPadDrcError(error),
        ),
      }
    }
    Object.defineProperty(this.legacyDrcEvaluator, "inputMode", {
      get: () =>
        (params.drcEvaluator?.evaluateLegacy ?? params.drcEvaluator)?.inputMode,
    })
    this.params = {
      ...params,
      autoroutingDrcEngine: this.autoroutingDrcEngine,
    }
    this.inputHdRoutes = params.hdRoutes
    this.guardedInputHdRoutes = materializeRoutes(cloneRoutes(params.hdRoutes))
    this.broadMaxIterations = params.broadMaxIterations
    this.broadPassMultiplier = params.broadPassMultiplier
    this.outputHdRoutes = params.hdRoutes
    if (this.params.referenceDrcEvaluator) {
      this.referenceInputSnapshot = this.getReferenceDrcSnapshot(
        this.inputHdRoutes,
      )
    }
  }


  override getSolverName(): string {
    // Preserve the pinned solver's public diagnostics while the coordinator
    // supplies asynchronous execution of its independent force trials.
    // Branch labels and failure messages remain identical to the native API.
    const name = "GlobalDrcBranchPortfolioSolver"
    return name
  }

  startAsyncExecution(): void {
    if (this.launched) return
    this.launched = true
    const promise = this.solveAsync().then((): void => {
      this.pendingEffects = []
    }, (error: unknown): never => {
      this.failed = true
      this.error = `${this.getSolverName()} error: ${error}`
      throw error
    })
    this.pendingEffects = [{ name: "parallel-global-drc-force-trials", promise }]
  }

  async solveAsync(): Promise<void> {
    const startedAt = Date.now()
    while (!this.solved && !this.failed) {
      if (this.activeSubSolver instanceof GlobalDrcForceImproveSolver) {
        await this.activeSubSolver.prepareForNextStep()
      }
      this.step()
    }
    this.timeToSolve = Date.now() - startedAt
  }

  override solve(): void {
    throw new Error("Parallel global DRC portfolio requires asynchronous execution")
  }

  override getConstructorParams(): readonly [GlobalDrcBranchPortfolioSolverParams] {
    return [
      {
        ...this.params,
        hdRoutes: this.inputHdRoutes,
      },
    ] as const
  }

  private stepBranch(solver: GlobalDrcForceImproveSolver, branchName: string) {
    this.activeSubSolver = solver
    solver.step()
    if (solver.failed) {
      throw new Error(`${branchName} DRC repair branch failed: ${solver.error}`)
    }
  }

  private getReferenceDrcSnapshot(routes: HighDensityRoute[]) {
    const evaluatorInput = {
      traces: [],
      srj: this.params.srj,
      routes,
      hdRoutes: routes,
    }
    const cachedResult =
      this.params.referenceDrcEvaluator?.getCachedResult?.(evaluatorInput)
    if (cachedResult) {
      const errors = Array.isArray(cachedResult)
        ? cachedResult
        : cachedResult.errors
      return { errors, count: errors.length }
    }
    return getDrcSnapshot(
      this.params.srj,
      routes,
      this.params.referenceDrcEvaluator,
      this.params.connMap,
      this.autoroutingDrcEngine,
    )
  }

  private finishWithOutput(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
    selectedSolver?: GlobalDrcForceImproveSolver,
  ) {
    let acceptedRoutes = routes
    let acceptedSnapshot = snapshot
    if (this.params.referenceDrcEvaluator) {
      const referenceInputSnapshot = this.referenceInputSnapshot!
      const referenceCandidateSnapshot =
        this.getReferenceDrcSnapshot(acceptedRoutes)
      this.referenceInputDrcIssueCount = referenceInputSnapshot.count
      this.referenceCandidateDrcIssueCount = referenceCandidateSnapshot.count
      if (
        referenceCandidateSnapshot.count > referenceInputSnapshot.count ||
        (referenceCandidateSnapshot.count === referenceInputSnapshot.count &&
          hasNewDrcErrorIdentities(
            referenceCandidateSnapshot.errors,
            referenceInputSnapshot.errors,
          ))
      ) {
        acceptedRoutes = this.guardedInputHdRoutes
        acceptedSnapshot = this.inputSnapshot!
        this.referenceCandidateRolledBack = true
      }
    }
    this.outputHdRoutes = acceptedRoutes
    this.selectedSolver = selectedSolver
    this.activeSubSolver = null
    this.phase = "done"
    this.progress = 1
    this.stats = {
      ...(this.portfolioSelectedSolver?.stats ?? {}),
      ...(selectedSolver?.stats ?? {}),
      finalDrcIssueCount: acceptedSnapshot.count,
      drcBranchPortfolioInitialDrcIssueCount:
        this.inputSnapshot?.count ?? snapshot.count,
      drcBranchPortfolioBaselineDrcIssueCount:
        this.baselineSnapshot?.count ?? snapshot.count,
      drcBranchPortfolioBroadInitialDrcIssueCount:
        this.broadInputSnapshot?.count,
      drcBranchPortfolioBroadFinalDrcIssueCount: this.broadSnapshot?.count,
      drcBranchPortfolioBroadMaxIterations: this.broadMaxIterations,
      drcBranchPortfolioBroadBranchAttempted: Boolean(this.broadSolver),
      drcBranchPortfolioBroadBranchAccepted:
        this.portfolioSelectedSolver !== undefined &&
        this.portfolioSelectedSolver === this.broadSolver,
      drcBranchPortfolioSafeTraceLayerPhaseAttempted: Boolean(
        this.safeTraceLayerSolver,
      ),
      drcBranchPortfolioSafeTraceLayerPhaseAccepted:
        this.safeTraceLayerPhaseAccepted,
      drcBranchPortfolioMixedSafeTraceLayerPhaseAttempted: Boolean(
        this.mixedSafeTraceLayerSolver,
      ),
      drcBranchPortfolioMixedSafeTraceLayerPhaseAccepted:
        this.mixedSafeTraceLayerPhaseAccepted,
      drcBranchPortfolioViaInPadPhaseAttempted: Boolean(this.viaInPadSolver),
      drcBranchPortfolioViaInPadMaxIterations:
        this.params.viaInPadMaxIterations,
      drcBranchPortfolioFinalNonViaPadDrcIssueCount:
        getNonViaPadDrcIssueCount(acceptedSnapshot),
      drcBranchPortfolioReferenceInputDrcIssueCount:
        this.referenceInputDrcIssueCount,
      drcBranchPortfolioReferenceCandidateDrcIssueCount:
        this.referenceCandidateDrcIssueCount,
      drcBranchPortfolioReferenceCandidateRolledBack:
        this.referenceCandidateRolledBack,
      drcBranchPortfolioMixedReferenceInputDrcIssueCount:
        this.mixedReferenceInputDrcIssueCount,
      drcBranchPortfolioMixedReferenceCandidateDrcIssueCount:
        this.mixedReferenceCandidateDrcIssueCount,
    }
    this.solved = true
  }

  private startBaselineBranch() {
    this.baselineSolver = new GlobalDrcForceImproveSolver({
      ...this.params,
      hdRoutes: this.inputHdRoutes,
      drcEvaluator: this.legacyDrcEvaluator,
      referenceDrcEvaluator: undefined,
      enableSafeTraceLayerMoves: false,
      enableViaInPadLayerMoves: false,
    }, this.coordinator)
    this.activeSubSolver = this.baselineSolver
    this.phase = "baseline"
  }

  private startSafeTraceLayerPhase(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
    portfolioSelectedSolver?: GlobalDrcForceImproveSolver,
  ) {
    this.portfolioSelectedSolver = portfolioSelectedSolver
    if (!this.params.enableSafeTraceLayerMoves) {
      this.startViaInPadPhase(routes, snapshot, portfolioSelectedSolver)
      return
    }
    this.safeTraceLayerInputRoutes = routes
    this.safeTraceLayerInputSnapshot = snapshot
    this.safeTraceLayerSolver = new GlobalDrcForceImproveSolver({
      ...this.params,
      hdRoutes: routes,
      drcEvaluator: this.legacyDrcEvaluator,
      referenceDrcEvaluator: undefined,
      maxIterations:
        this.params.viaInPadMaxIterations ?? this.params.maxIterations,
      enableLargeBoardBroadFallback: false,
      enableTargetedErrorSweep: false,
      enablePostSolveClearanceRelaxation: false,
      enableSafeTraceLayerMoves: true,
      enableViaInPadLayerMoves: false,
    }, this.coordinator)
    this.activeSubSolver = this.safeTraceLayerSolver
    this.phase = "safeTraceLayer"
  }

  private startViaInPadPhase(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
    portfolioSelectedSolver?: GlobalDrcForceImproveSolver,
  ) {
    this.portfolioSelectedSolver = portfolioSelectedSolver
    const shouldRunViaInPadTopologyRepair =
      this.params.enableViaInPadLayerMoves &&
      this.params.viaInPadDrcEvaluator !== undefined
    if (
      !snapshot.errors.some(isViaPadDrcError) &&
      !shouldRunViaInPadTopologyRepair
    ) {
      this.finishWithOutput(routes, snapshot, portfolioSelectedSolver)
      return
    }
    this.viaInPadSolver = new GlobalDrcForceImproveSolver({
      ...this.params,
      hdRoutes: routes,
      drcEvaluator:
        this.params.viaInPadDrcEvaluator ?? this.params.drcEvaluator,
      maxIterations:
        this.params.viaInPadMaxIterations ?? this.params.maxIterations,
      enableLargeBoardBroadFallback: false,
      enableTargetedErrorSweep: false,
      enablePostSolveClearanceRelaxation: false,
      enableSafeTraceLayerMoves: false,
      enableViaInPadLayerMoves: this.params.enableViaInPadLayerMoves,
    }, this.coordinator)
    this.activeSubSolver = this.viaInPadSolver
    this.phase = "viaInPad"
  }

  private startMixedSafeTraceLayerPhase(
    legacyRoutes: HighDensityRoute[],
    legacySnapshot: DrcSnapshot,
    legacySelectedSolver?: GlobalDrcForceImproveSolver,
  ) {
    this.legacySafeTraceLayerRoutes = legacyRoutes
    this.legacySafeTraceLayerSnapshot = legacySnapshot
    this.legacySafeTraceLayerSelectedSolver = legacySelectedSolver
    this.mixedSafeTraceLayerSolver = new GlobalDrcForceImproveSolver({
      ...this.params,
      hdRoutes: this.safeTraceLayerInputRoutes!,
      drcEvaluator: this.params.drcEvaluator,
      referenceDrcEvaluator: undefined,
      maxIterations:
        this.params.viaInPadMaxIterations ?? this.params.maxIterations,
      enableLargeBoardBroadFallback: false,
      enableTargetedErrorSweep: false,
      enablePostSolveClearanceRelaxation: false,
      enableSafeTraceLayerMoves: true,
      enableViaInPadLayerMoves: false,
    }, this.coordinator)
    this.activeSubSolver = this.mixedSafeTraceLayerSolver
    this.phase = "mixedSafeTraceLayer"
  }

  private startBroadBranch() {
    const broadInputRoutes = applyBroadRepulsionForces(
      this.params.srj,
      this.inputHdRoutes,
      this.params.effort ?? 1,
      this.broadPassMultiplier,
      this.params.connMap,
    )
    this.broadInputSnapshot = getDrcSnapshot(
      this.params.srj,
      broadInputRoutes,
      this.params.drcEvaluator,
      this.params.connMap,
      this.autoroutingDrcEngine,
    )
    if (
      !isDrcSnapshotCountBetter(this.broadInputSnapshot, this.baselineSnapshot!)
    ) {
      this.startSafeTraceLayerPhase(
        this.baselineSolver!.getOutput(),
        this.baselineSnapshot!,
        this.baselineSolver,
      )
      return
    }
    this.broadSolver = new GlobalDrcForceImproveSolver({
      ...this.params,
      hdRoutes: broadInputRoutes,
      drcEvaluator: this.legacyDrcEvaluator,
      referenceDrcEvaluator: undefined,
      maxIterations: this.broadMaxIterations,
      enableSafeTraceLayerMoves: false,
      enableViaInPadLayerMoves: false,
    }, this.coordinator)
    this.activeSubSolver = this.broadSolver
    this.phase = "broad"
  }

  override _step() {
    if (this.phase === "start") {
      this.inputSnapshot = getDrcSnapshot(
        this.params.srj,
        this.inputHdRoutes,
        this.params.drcEvaluator,
        this.params.connMap,
        this.autoroutingDrcEngine,
      )
      if (getNonViaPadDrcIssueCount(this.inputSnapshot) === 0) {
        this.startViaInPadPhase(this.inputHdRoutes, this.inputSnapshot)
        return
      }
      this.startBaselineBranch()
      return
    }

    if (this.phase === "baseline") {
      this.stepBranch(this.baselineSolver!, "baseline")
      if (!this.baselineSolver!.solved) return
      const baselineRoutes = this.baselineSolver!.getOutput()
      this.baselineSnapshot = getDrcSnapshot(
        this.params.srj,
        baselineRoutes,
        this.params.drcEvaluator,
        this.params.connMap,
        this.autoroutingDrcEngine,
      )
      if (getNonViaPadDrcIssueCount(this.baselineSnapshot) === 0) {
        this.startViaInPadPhase(
          baselineRoutes,
          this.baselineSnapshot,
          this.baselineSolver,
        )
        return
      }
      if (
        this.params.enableSafeTraceLayerMoves &&
        this.baselineSnapshot.count <= LOW_COUNT_SAFE_TRACE_LAYER_MAX_DRC_ISSUES
      ) {
        this.startSafeTraceLayerPhase(
          baselineRoutes,
          this.baselineSnapshot,
          this.baselineSolver,
        )
      } else {
        this.startBroadBranch()
      }
      return
    }

    if (this.phase === "broad") {
      this.stepBranch(this.broadSolver!, "broad")
      if (!this.broadSolver!.solved) return
      const broadRoutes = this.broadSolver!.getOutput()
      this.broadSnapshot = getDrcSnapshot(
        this.params.srj,
        broadRoutes,
        this.params.drcEvaluator,
        this.params.connMap,
        this.autoroutingDrcEngine,
      )
      if (
        isDrcSnapshotCountBetter(this.broadSnapshot, this.baselineSnapshot!)
      ) {
        this.startSafeTraceLayerPhase(
          broadRoutes,
          this.broadSnapshot,
          this.broadSolver,
        )
        return
      }
      this.startSafeTraceLayerPhase(
        this.baselineSolver!.getOutput(),
        this.baselineSnapshot!,
        this.baselineSolver,
      )
      return
    }

    if (this.phase === "safeTraceLayer") {
      this.stepBranch(this.safeTraceLayerSolver!, "safe trace-layer")
      if (!this.safeTraceLayerSolver!.solved) return
      const safeTraceLayerRoutes = this.safeTraceLayerSolver!.getOutput()
      const safeTraceLayerSnapshot = getDrcSnapshot(
        this.params.srj,
        safeTraceLayerRoutes,
        this.params.drcEvaluator,
        this.params.connMap,
        this.autoroutingDrcEngine,
      )
      // Match the inner solver's staged scoring: via-pad issues are handled
      // by the following phase, while via-pair/trace collisions stay guarded.
      const inputViaIssueCount = getViaDrcIssueCount(
        this.safeTraceLayerInputSnapshot!,
        false,
      )
      const safeTraceLayerViaIssueCount = getViaDrcIssueCount(
        safeTraceLayerSnapshot,
        false,
      )
      this.safeTraceLayerPhaseAccepted =
        safeTraceLayerViaIssueCount <= inputViaIssueCount &&
        isBetterDrcSnapshot(
          safeTraceLayerSnapshot,
          safeTraceLayerViaIssueCount,
          this.safeTraceLayerInputSnapshot!.count,
          this.safeTraceLayerInputSnapshot!.issueScore,
          inputViaIssueCount,
          this.safeTraceLayerInputSnapshot!,
        )
      let acceptedRoutes = this.safeTraceLayerPhaseAccepted
        ? safeTraceLayerRoutes
        : this.safeTraceLayerInputRoutes!
      let acceptedSnapshot = this.safeTraceLayerPhaseAccepted
        ? safeTraceLayerSnapshot
        : this.safeTraceLayerInputSnapshot!
      let acceptedSolver = this.safeTraceLayerPhaseAccepted
        ? this.safeTraceLayerSolver
        : this.portfolioSelectedSolver
      if (
        this.preBroadCandidate &&
        !isDrcSnapshotCountBetter(
          acceptedSnapshot,
          this.preBroadCandidate.snapshot,
        )
      ) {
        acceptedRoutes = this.preBroadCandidate.routes
        acceptedSnapshot = this.preBroadCandidate.snapshot
        acceptedSolver = this.preBroadCandidate.solver
        this.safeTraceLayerPhaseAccepted =
          this.preBroadCandidate.safeTraceLayerPhaseAccepted
      }
      if (acceptedSnapshot.count > 0 && !this.broadInputSnapshot) {
        // Broad repair starts again from the original input. Keep the accepted
        // safe-layer result unless the later branch actually improves it.
        this.preBroadCandidate = {
          routes: acceptedRoutes,
          snapshot: acceptedSnapshot,
          solver: acceptedSolver,
          safeTraceLayerPhaseAccepted: this.safeTraceLayerPhaseAccepted,
        }
        this.startBroadBranch()
        return
      }
      if (
        getNonViaPadDrcIssueCount(acceptedSnapshot) > 0 &&
        this.safeTraceLayerInputSnapshot!.errors.some(isViaPadDrcError)
      ) {
        this.startMixedSafeTraceLayerPhase(
          acceptedRoutes,
          acceptedSnapshot,
          acceptedSolver,
        )
        return
      }
      this.startViaInPadPhase(acceptedRoutes, acceptedSnapshot, acceptedSolver)
      return
    }

    if (this.phase === "mixedSafeTraceLayer") {
      this.stepBranch(this.mixedSafeTraceLayerSolver!, "mixed safe trace-layer")
      if (!this.mixedSafeTraceLayerSolver!.solved) return
      const mixedRoutes = this.mixedSafeTraceLayerSolver!.getOutput()
      const mixedSnapshot = getDrcSnapshot(
        this.params.srj,
        mixedRoutes,
        this.params.drcEvaluator,
        this.params.connMap,
        this.autoroutingDrcEngine,
      )
      const doesNotRegressLegacyDrc =
        getNonViaPadDrcIssueCount(mixedSnapshot) <=
        getNonViaPadDrcIssueCount(this.legacySafeTraceLayerSnapshot!)
      let improvesReferenceDrc = true
      if (this.params.referenceDrcEvaluator) {
        const referenceInputSnapshot = this.getReferenceDrcSnapshot(
          this.legacySafeTraceLayerRoutes!,
        )
        const referenceCandidateSnapshot =
          this.getReferenceDrcSnapshot(mixedRoutes)
        this.mixedReferenceInputDrcIssueCount = referenceInputSnapshot.count
        this.mixedReferenceCandidateDrcIssueCount =
          referenceCandidateSnapshot.count
        improvesReferenceDrc =
          referenceCandidateSnapshot.count <= referenceInputSnapshot.count
      }
      this.mixedSafeTraceLayerPhaseAccepted =
        doesNotRegressLegacyDrc && improvesReferenceDrc
      this.startViaInPadPhase(
        this.mixedSafeTraceLayerPhaseAccepted
          ? mixedRoutes
          : this.legacySafeTraceLayerRoutes!,
        this.mixedSafeTraceLayerPhaseAccepted
          ? mixedSnapshot
          : this.legacySafeTraceLayerSnapshot!,
        this.mixedSafeTraceLayerPhaseAccepted
          ? this.mixedSafeTraceLayerSolver
          : this.legacySafeTraceLayerSelectedSolver,
      )
      return
    }

    if (this.phase === "viaInPad") {
      this.stepBranch(this.viaInPadSolver!, "via-in-pad")
      if (!this.viaInPadSolver!.solved) return
      const viaInPadRoutes = this.viaInPadSolver!.getOutput()
      const viaInPadSnapshot = getDrcSnapshot(
        this.params.srj,
        viaInPadRoutes,
        this.params.viaInPadDrcEvaluator ?? this.params.drcEvaluator,
        this.params.connMap,
        this.autoroutingDrcEngine,
      )
      this.finishWithOutput(
        viaInPadRoutes,
        viaInPadSnapshot,
        this.viaInPadSolver,
      )
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
