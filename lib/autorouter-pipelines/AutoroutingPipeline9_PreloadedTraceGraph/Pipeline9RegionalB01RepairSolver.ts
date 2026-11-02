import { GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import { applyBroadRepulsionForces } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { isViaPadClearanceError } from "./isViaPadClearanceError"
import {
  getPipeline9TracePairRepairOutput,
  preparePipeline9TracePairRepair,
  type Pipeline9TracePairRepair,
} from "./preparePipeline9TracePairRepair"
import { Pipeline9ClearanceProjectionSolver } from "./Pipeline9ClearanceProjectionSolver"
import {
  createFixedRouteCopperSpatialIndex,
  getPipeline9RegionalB01CandidateOutput,
  getPipeline9RegionalRepairSearchBudget,
  getPipeline9RegionalRepairTraceIds,
  getPipeline9RegularRegionalCandidateOutput,
  getRepairCenter,
  getViaIssueCount,
  isMovableTracePairError,
  PIPELINE9_REGIONAL_B01_REGION_SIZES,
  preparePipeline9RegionalB01Candidate,
  preparePipeline9RegularRegionalCandidate,
  type FixedRouteCopperSpatialIndex,
  type Pipeline9RegionalB01CandidateProblem,
  type Pipeline9RegionalB01RepairParams,
  type Pipeline9RegionalB01RepairResult,
  type Pipeline9RegularRegionalCandidateProblem,
} from "./applyPipeline9RegionalB01Repairs"
import {
  getPipeline9DrcErrors,
  getPipeline9RouteIndexByTraceId,
  isPipeline9DrcCandidateBetter,
  isPipeline9DrcErrorOwnedByPreloadRepair,
  type Pipeline9DrcError,
} from "./pipeline9JointDrcRepairUtils"
import { restorePipeline9TerminalApproaches } from "./restorePipeline9TerminalApproaches"

type RegionalB01RepairPhase =
  | "initialize"
  | "begin-pass"
  | "begin-error"
  | "prepare-pair"
  | "route-pair"
  | "validate-pair"
  | "prepare-b01"
  | "route-b01"
  | "validate-b01"
  | "prepare-regional"
  | "route-regional"
  | "validate-regional"
  | "commit-error"
  | "finish-pass"
  | "refine"
  | "prepare-via-pad-projection"
  | "project-via-pad"
  | "prepare-safe-layer"
  | "route-safe-layer"
  | "validate-safe-layer"
  | "done"

/** Routes one regional candidate at a time through explicit child solver stages. */
export class Pipeline9RegionalB01RepairSolver extends BaseSolver {
  readonly params: Pipeline9RegionalB01RepairParams
  readonly candidateSearchBudget: number
  phase: RegionalB01RepairPhase = "initialize"
  result?: Pipeline9RegionalB01RepairResult
  private currentRoutes: HighDensityRoute[]
  private currentErrors: Pipeline9DrcError[] = []
  private bestRoutes: HighDensityRoute[]
  private bestErrors: Pipeline9DrcError[] = []
  private fixedRouteCopperSpatialIndex?: FixedRouteCopperSpatialIndex
  private routeIndexByTraceId = new Map<string, number>()
  private repairableErrors: Pipeline9DrcError[] = []
  private passIndex = 0
  private errorIndex = 0
  private traceIndex = 0
  private regionIndex = 0
  private traceIds: string[] = []
  private repairCenter?: { x: number; y: number }
  private stopB01SearchForError = false
  private acceptedOnPass = false
  private attemptedCandidateCount = 0
  private acceptedCandidateCount = 0
  private fallbackCandidateCount = 0
  private candidateSearchCount = 0
  private candidateSearchBudgetExhausted = false
  private safeTraceLayerRepairSkippedForBudget = false
  private preloadEligibleDrcIssueCount = 0
  private pairCandidate?: Pipeline9TracePairRepair
  private b01Candidate?: Pipeline9RegionalB01CandidateProblem
  private regularCandidate?: Pipeline9RegularRegionalCandidateProblem
  private safeTraceLayerSolver?: GlobalDrcForceImproveSolver
  private viaPadProjectionSolver?: Pipeline9ClearanceProjectionSolver

  constructor(params: Pipeline9RegionalB01RepairParams) {
    super()
    this.params = params
    this.currentRoutes = params.routes
    this.bestRoutes = params.routes
    this.candidateSearchBudget = getPipeline9RegionalRepairSearchBudget(
      params.routes.length,
    )
    // Reserve finite overhead for candidate setup, validation, and pass stages.
    // Child iteration limits are added when each candidate is constructed.
    this.MAX_ITERATIONS = 64 + 8 * this.candidateSearchBudget
  }

  private initializeRepair(): void {
    const {
      initialErrors,
      drcEvaluator,
      newConnections,
      syntheticConnectionNames,
    } = this.params
    this.currentErrors =
      initialErrors ?? getPipeline9DrcErrors(drcEvaluator, this.currentRoutes)
    // Accepted candidates never increase the error count across the two passes.
    this.MAX_ITERATIONS += 16 * this.currentErrors.length
    this.preloadEligibleDrcIssueCount = this.currentErrors.filter(
      (error): boolean =>
        isPipeline9DrcErrorOwnedByPreloadRepair({
          error,
          preloadRepairTraceIds: this.params.preloadRepairTraceIds,
        }),
    ).length
    const initialRouteIndexByTraceId = getPipeline9RouteIndexByTraceId({
      routes: this.currentRoutes,
      newConnections,
      syntheticConnectionNames,
    })
    const hasMovableTracePair =
      this.params.allowTracePairRepair === true &&
      this.currentErrors.some((error): boolean =>
        isMovableTracePairError(error, initialRouteIndexByTraceId),
      )
    if (this.preloadEligibleDrcIssueCount === 0 && !hasMovableTracePair) {
      this.finishRepair()
      return
    }
    this.fixedRouteCopperSpatialIndex = createFixedRouteCopperSpatialIndex(
      this.params.fixedObstacleRoutes,
      this.params.srj,
    )
    this.phase = "begin-pass"
  }

  private beginPass(): void {
    if (this.candidateSearchBudgetExhausted || this.passIndex >= 2) {
      this.phase = "refine"
      return
    }
    this.acceptedOnPass = false
    this.routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
      routes: this.currentRoutes,
      newConnections: this.params.newConnections,
      syntheticConnectionNames: this.params.syntheticConnectionNames,
    })
    this.repairableErrors = this.currentErrors.filter(
      (error): boolean =>
        (error.type === "pcb_trace_error" ||
          error.type === "pcb_pad_trace_clearance_error" ||
          error.type === "pcb_via_trace_clearance_error" ||
          error.type === "pcb_via_clearance_error" ||
          isViaPadClearanceError(error)) &&
        typeof error.pcb_trace_id === "string",
    )
    this.errorIndex = 0
    this.phase = "begin-error"
  }

  private beginError(): void {
    if (
      this.candidateSearchBudgetExhausted ||
      this.errorIndex >= this.repairableErrors.length
    ) {
      this.phase = "finish-pass"
      return
    }
    const error = this.repairableErrors[this.errorIndex]!
    this.repairCenter = getRepairCenter(error, this.params.srj)
    this.traceIds = getPipeline9RegionalRepairTraceIds({
      error,
      routeIndexByTraceId: this.routeIndexByTraceId,
    }).slice(0, 2)
    if (!this.repairCenter) {
      this.errorIndex++
      return
    }
    this.bestRoutes = this.currentRoutes
    this.bestErrors = this.currentErrors
    this.traceIndex = 0
    this.regionIndex = 0
    this.stopB01SearchForError = false
    this.phase = isMovableTracePairError(error, this.routeIndexByTraceId)
      ? "prepare-pair"
      : "prepare-b01"
  }

  private preparePairCandidate(): void {
    if (this.candidateSearchCount >= this.candidateSearchBudget) {
      this.candidateSearchBudgetExhausted = true
      this.phase = "commit-error"
      return
    }
    const indexes = this.traceIds.map((id) => this.routeIndexByTraceId.get(id)!)
    this.pairCandidate = preparePipeline9TracePairRepair({
      ...this.params,
      routes: this.currentRoutes,
      routeIndexes: [indexes[0]!, indexes[1]!],
    })
    if (!this.pairCandidate) {
      this.phase = "prepare-b01"
      return
    }
    this.candidateSearchCount++
    this.startChildSolver(this.pairCandidate.solver)
    this.phase = "route-pair"
  }

  private stepPairCandidate(): void {
    const candidate = this.pairCandidate
    if (!candidate) throw new Error("Regional pair repair has no candidate")
    candidate.solver.step()
    if (!candidate.solver.solved && !candidate.solver.failed) return
    this.activeSubSolver = null
    this.phase = "validate-pair"
  }

  private validatePairCandidate(): void {
    const candidate = this.pairCandidate
    if (!candidate)
      throw new Error("Regional pair repair has no completed candidate")
    const routes = getPipeline9TracePairRepairOutput(candidate)
    this.pairCandidate = undefined
    this.phase = "prepare-b01"
    if (!routes) return
    this.attemptedCandidateCount++
    const errors = getPipeline9DrcErrors(this.params.drcEvaluator, routes)
    if (isPipeline9DrcCandidateBetter(errors, this.bestErrors)) {
      this.bestRoutes = routes
      this.bestErrors = errors
      this.phase = "commit-error"
    }
  }

  private startChildSolver(solver: BaseSolver): void {
    const childStepBudget = Math.floor(solver.MAX_ITERATIONS) + 1
    if (!Number.isSafeInteger(childStepBudget) || childStepBudget < 1) {
      throw new Error("Regional B01 child has an invalid iteration limit")
    }
    this.MAX_ITERATIONS += childStepBudget
    this.activeSubSolver = solver
  }

  private prepareB01Candidate(): void {
    if (
      this.stopB01SearchForError ||
      this.candidateSearchBudgetExhausted ||
      this.traceIndex >= this.traceIds.length
    ) {
      this.phase = "prepare-regional"
      return
    }
    const routeIndex = this.routeIndexByTraceId.get(
      this.traceIds[this.traceIndex]!,
    )
    if (routeIndex === undefined) {
      this.traceIndex++
      this.regionIndex = 0
      return
    }
    if (this.regionIndex >= PIPELINE9_REGIONAL_B01_REGION_SIZES.length) {
      if (this.bestErrors.length === 0) {
        this.stopB01SearchForError = true
      } else {
        this.traceIndex++
        this.regionIndex = 0
      }
      return
    }
    if (this.candidateSearchCount >= this.candidateSearchBudget) {
      this.candidateSearchBudgetExhausted = true
      this.phase = "prepare-regional"
      return
    }
    const center = this.repairCenter
    if (!center) throw new Error("Regional B01 candidate has no repair center")
    const regionSize = PIPELINE9_REGIONAL_B01_REGION_SIZES[this.regionIndex]!
    this.regionIndex++
    this.candidateSearchCount++
    this.b01Candidate = preparePipeline9RegionalB01Candidate({
      ...this.params,
      routes: this.currentRoutes,
      routeIndex,
      center,
      regionSize,
    })
    if (!this.b01Candidate) return
    this.startChildSolver(this.b01Candidate.solver)
    this.phase = "route-b01"
  }

  private stepB01Candidate(): void {
    const candidate = this.b01Candidate
    if (!candidate) throw new Error("Regional B01 has no active candidate")
    candidate.solver.step()
    if (!candidate.solver.solved && !candidate.solver.failed) return
    this.activeSubSolver = null
    this.phase = "validate-b01"
  }

  private validateB01Candidate(): void {
    const problem = this.b01Candidate
    if (!problem) throw new Error("Regional B01 has no completed candidate")
    const candidate = getPipeline9RegionalB01CandidateOutput(problem)
    this.b01Candidate = undefined
    if (candidate) {
      this.attemptedCandidateCount++
      if (candidate.usedFallback) this.fallbackCandidateCount++
      const candidateErrors = getPipeline9DrcErrors(
        this.params.drcEvaluator,
        candidate.routes,
      )
      if (isPipeline9DrcCandidateBetter(candidateErrors, this.bestErrors)) {
        this.bestRoutes = candidate.routes
        this.bestErrors = candidateErrors
      }
      if (this.bestErrors.length === 0) this.stopB01SearchForError = true
    }
    this.phase = "prepare-b01"
  }

  private prepareRegularCandidate(): void {
    if (
      this.bestRoutes !== this.currentRoutes ||
      this.candidateSearchBudgetExhausted
    ) {
      this.phase = "commit-error"
      return
    }
    if (this.candidateSearchCount >= this.candidateSearchBudget) {
      this.candidateSearchBudgetExhausted = true
      this.phase = "commit-error"
      return
    }
    this.candidateSearchCount++
    const center = this.repairCenter
    const fixedRouteCopperSpatialIndex = this.fixedRouteCopperSpatialIndex
    if (!center || !fixedRouteCopperSpatialIndex) {
      throw new Error(
        "Regional fallback candidate is missing its fixed context",
      )
    }
    this.regularCandidate = preparePipeline9RegularRegionalCandidate({
      ...this.params,
      routes: this.currentRoutes,
      fixedRouteCopperSpatialIndex,
      center,
      regionSize: 3,
    })
    if (!this.regularCandidate) {
      this.phase = "commit-error"
      return
    }
    this.startChildSolver(this.regularCandidate.solver)
    this.phase = "route-regional"
  }

  private stepRegularCandidate(): void {
    const candidate = this.regularCandidate
    if (!candidate) throw new Error("Regional fallback has no active candidate")
    candidate.solver.step()
    if (!candidate.solver.solved && !candidate.solver.failed) return
    this.activeSubSolver = null
    this.phase = "validate-regional"
  }

  private validateRegularCandidate(): void {
    const problem = this.regularCandidate
    if (!problem)
      throw new Error("Regional fallback has no completed candidate")
    const routes = getPipeline9RegularRegionalCandidateOutput(problem)
    this.regularCandidate = undefined
    if (routes) {
      this.attemptedCandidateCount++
      this.fallbackCandidateCount++
      const errors = getPipeline9DrcErrors(this.params.drcEvaluator, routes)
      if (isPipeline9DrcCandidateBetter(errors, this.bestErrors)) {
        this.bestRoutes = routes
        this.bestErrors = errors
      }
    }
    this.phase = "commit-error"
  }

  private commitErrorRepair(): void {
    if (this.bestRoutes !== this.currentRoutes) {
      this.currentRoutes = this.bestRoutes
      this.currentErrors = this.bestErrors
      this.acceptedCandidateCount++
      this.acceptedOnPass = true
    }
    this.errorIndex++
    this.phase = this.candidateSearchBudgetExhausted
      ? "finish-pass"
      : "begin-error"
  }

  private finishPass(): void {
    this.passIndex++
    this.phase =
      !this.acceptedOnPass ||
      this.currentErrors.length === 0 ||
      this.candidateSearchBudgetExhausted
        ? "refine"
        : "begin-pass"
  }

  private refineAcceptedRoutes(): void {
    if (this.acceptedCandidateCount > 0 && this.currentErrors.length > 0) {
      const refinedRoutes = restorePipeline9TerminalApproaches(
        this.currentRoutes,
        applyBroadRepulsionForces(
          { ...this.params.srj, traces: undefined },
          this.currentRoutes,
          this.params.effort,
          1,
          this.params.connMap,
        ),
      )
      if (refinedRoutes && refinedRoutes !== this.currentRoutes) {
        const errors = getPipeline9DrcErrors(
          this.params.drcEvaluator,
          refinedRoutes,
        )
        if (
          getViaIssueCount(errors) <= getViaIssueCount(this.currentErrors) &&
          isPipeline9DrcCandidateBetter(errors, this.currentErrors)
        ) {
          this.currentRoutes = refinedRoutes
          this.currentErrors = errors
        }
      }
    }
    this.phase = "prepare-via-pad-projection"
  }

  private prepareViaPadProjection(): void {
    const movableRegions = this.currentErrors
      .filter(isViaPadClearanceError)
      .flatMap((error) => {
        const center = getRepairCenter(error, this.params.srj)
        return center
          ? [{ center, radius: PIPELINE9_REGIONAL_B01_REGION_SIZES[0] / 2 }]
          : []
      })
    if (movableRegions.length === 0) {
      this.phase = "prepare-safe-layer"
      return
    }
    const routeCount = this.currentRoutes.length
    // A physical via can belong to multiple same-net route pieces. Project
    // those pieces together with nearby wires, keeping all preload copper fixed.
    this.viaPadProjectionSolver = new Pipeline9ClearanceProjectionSolver({
      originalSrj: this.params.srj,
      routes: [...this.currentRoutes, ...this.params.fixedObstacleRoutes],
      lockedConnectionNames: new Set([
        ...this.params.syntheticConnectionNames,
        ...this.params.fixedObstacleRoutes.map((route) => route.connectionName),
      ]),
      movableRegions,
      usePrecisionMargin: true,
      drcEvaluator: ({ hdRoutes }) => {
        if (!hdRoutes) throw new Error("Via-pad projection requires HD routes")
        return this.params.drcEvaluator({
          traces: [],
          hdRoutes: hdRoutes.slice(0, routeCount),
        })
      },
    })
    this.startChildSolver(this.viaPadProjectionSolver)
    this.phase = "project-via-pad"
  }

  private stepViaPadProjection(): void {
    const solver = this.viaPadProjectionSolver
    if (!solver) throw new Error("Regional B01 has no via-pad projection")
    solver.step()
    this.MAX_ITERATIONS = Math.max(
      this.MAX_ITERATIONS,
      this.iterations + solver.MAX_ITERATIONS - solver.iterations + 16,
    )
    if (solver.failed) {
      throw new Error(`Regional via-pad projection failed: ${solver.error}`)
    }
    if (!solver.solved) return
    this.currentRoutes = solver.getOutput().slice(0, this.currentRoutes.length)
    this.currentErrors = getPipeline9DrcErrors(
      this.params.drcEvaluator,
      this.currentRoutes,
    )
    this.activeSubSolver = null
    this.phase = "prepare-safe-layer"
  }

  private prepareSafeLayerRepair(): void {
    const hasSafeLayerRepairableError = this.currentErrors.some(
      (error): boolean =>
        error.type === "pcb_trace_error" ||
        error.type === "pcb_pad_trace_clearance_error",
    )
    this.safeTraceLayerRepairSkippedForBudget =
      hasSafeLayerRepairableError && this.candidateSearchBudgetExhausted
    if (!hasSafeLayerRepairableError || this.candidateSearchBudgetExhausted) {
      this.finishRepair()
      return
    }
    this.safeTraceLayerSolver = new GlobalDrcForceImproveSolver({
      srj: { ...this.params.srj, traces: undefined },
      hdRoutes: this.currentRoutes,
      connMap: this.params.connMap,
      effort: this.params.effort,
      drcEvaluator: this.params.drcEvaluator,
      maxIterations: 8,
      enableLargeBoardBroadFallback: false,
      enableTargetedErrorSweep: false,
      enablePostSolveClearanceRelaxation: false,
      enableSafeTraceLayerMoves: true,
      enableViaInPadLayerMoves: false,
    })
    this.startChildSolver(this.safeTraceLayerSolver)
    this.phase = "route-safe-layer"
  }

  private stepSafeLayerRepair(): void {
    const solver = this.safeTraceLayerSolver
    if (!solver) throw new Error("Regional B01 has no safe trace-layer solver")
    solver.step()
    if (solver.failed) {
      throw new Error(
        `Pipeline9 post-regional safe trace-layer repair failed: ${solver.error ?? "unknown error"}`,
      )
    }
    if (!solver.solved) return
    this.activeSubSolver = null
    this.phase = "validate-safe-layer"
  }

  private validateSafeLayerRepair(): void {
    const solver = this.safeTraceLayerSolver
    if (!solver)
      throw new Error("Regional B01 has no completed safe trace-layer solver")
    const routes = solver.getOutput()
    const errors = getPipeline9DrcErrors(this.params.drcEvaluator, routes)
    if (isPipeline9DrcCandidateBetter(errors, this.currentErrors)) {
      this.currentRoutes = routes
      this.currentErrors = errors
    }
    this.safeTraceLayerSolver = undefined
    this.finishRepair()
  }

  private finishRepair(): void {
    this.result = {
      routes: this.currentRoutes,
      attemptedCandidateCount: this.attemptedCandidateCount,
      acceptedCandidateCount: this.acceptedCandidateCount,
      fallbackCandidateCount: this.fallbackCandidateCount,
      candidateSearchCount: this.candidateSearchCount,
      candidateSearchBudget: this.candidateSearchBudget,
      candidateSearchBudgetExhausted: this.candidateSearchBudgetExhausted,
      safeTraceLayerRepairSkippedForBudget:
        this.safeTraceLayerRepairSkippedForBudget,
      remainingDrcIssueCount: this.currentErrors.length,
      preloadEligibleDrcIssueCount: this.preloadEligibleDrcIssueCount,
      preloadRepairAttempted: this.preloadEligibleDrcIssueCount > 0,
    }
    this.activeSubSolver = null
    this.stats = { ...this.result, routes: undefined }
    this.phase = "done"
    this.solved = true
  }

  override _step(): void {
    switch (this.phase) {
      case "initialize":
        return this.initializeRepair()
      case "begin-pass":
        return this.beginPass()
      case "begin-error":
        return this.beginError()
      case "prepare-pair":
        return this.preparePairCandidate()
      case "route-pair":
        return this.stepPairCandidate()
      case "validate-pair":
        return this.validatePairCandidate()
      case "prepare-b01":
        return this.prepareB01Candidate()
      case "route-b01":
        return this.stepB01Candidate()
      case "validate-b01":
        return this.validateB01Candidate()
      case "prepare-regional":
        return this.prepareRegularCandidate()
      case "route-regional":
        return this.stepRegularCandidate()
      case "validate-regional":
        return this.validateRegularCandidate()
      case "commit-error":
        return this.commitErrorRepair()
      case "finish-pass":
        return this.finishPass()
      case "refine":
        return this.refineAcceptedRoutes()
      case "prepare-via-pad-projection":
        return this.prepareViaPadProjection()
      case "project-via-pad":
        return this.stepViaPadProjection()
      case "prepare-safe-layer":
        return this.prepareSafeLayerRepair()
      case "route-safe-layer":
        return this.stepSafeLayerRepair()
      case "validate-safe-layer":
        return this.validateSafeLayerRepair()
      case "done":
        throw new Error("Regional B01 repair was stepped after completion")
    }
  }

  computeProgress(): number {
    if (this.solved) return 1
    const activeProgress = this.activeSubSolver
      ? Math.max(0, Math.min(1, this.activeSubSolver.progress))
      : 1
    return Math.max(
      this.progress,
      Math.min(
        1,
        (Math.max(0, this.candidateSearchCount - 1) + activeProgress) /
          (this.candidateSearchBudget + 1),
      ),
    )
  }

  getResult(): Pipeline9RegionalB01RepairResult {
    if (!this.solved || this.failed || !this.result) {
      throw new Error("Pipeline9 regional B01 repair is not complete")
    }
    return this.result
  }
}
