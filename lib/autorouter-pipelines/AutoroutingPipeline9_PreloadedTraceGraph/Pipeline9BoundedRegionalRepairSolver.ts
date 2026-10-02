import {
  extractRepairRegion,
  getFixedObstacleViolations,
  getNewViaPadViolations,
  mergeRepairRegion,
  NegotiateTraceClearanceSolver,
  type Bounds,
  type ExtractedRepairRegion,
  type NegotiatedClearanceResult,
} from "@tscircuit/repair04"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import {
  getPipeline9BoundedRepairAllowance,
  PIPELINE9_BOUNDED_REPAIR_BUDGET,
  type Pipeline9BoundedRegionalRepairParams,
  type Pipeline9BoundedRegionalRepairResult,
  type Pipeline9BoundedRepairBudget,
} from "./applyPipeline9BoundedRegionalRepairs"
import { canonicalizePipeline9HdRoutes } from "./canonicalizePipeline9HdRoutes"
import { canPublishPartialFixedObstacleRepair } from "./canPublishPartialFixedObstacleRepair"
import { Pipeline9ClearanceProjectionSolver } from "./Pipeline9ClearanceProjectionSolver"
import { Pipeline9ReportedViaMergeSolver } from "./Pipeline9ReportedViaMergeSolver"

type DrcResult = ReturnType<DrcEvaluator>
type DrcErrors = Array<Record<string, unknown>>
type FixedViolations = ReturnType<typeof getFixedObstacleViolations>
type RepairAllowance = ReturnType<typeof getPipeline9BoundedRepairAllowance>

type InitialContext = {
  boundaryMargin: number
  regionSizes: number[]
}

type ReferencedContext = InitialContext & {
  currentRoutes: HighDensityRoute[]
  reference: DrcResult
  currentErrors: DrcErrors
  initialErrors: DrcErrors
}

type RegionalContext = ReferencedContext & {
  srj: SimpleRouteJson & { traces: undefined }
  obstacleCenterById: Map<string, { x: number; y: number }>
  attemptedRegions: Array<{ bounds: Bounds; size: number }>
  fixedViolations: Map<string, number>
}

type NegotiationContext = {
  context: RegionalContext
  allowance: RepairAllowance
  maxPathSearchCalls: number
  region: ExtractedRepairRegion
}

type CandidateContext = {
  context: RegionalContext
  candidateRoutes: HighDensityRoute[]
}

type CandidateValidationContext = CandidateContext & {
  candidateFixedViolations: FixedViolations
}

type BoundedRepairState =
  | { phase: "initialize" | "done" }
  | { phase: "initial-reference"; context: InitialContext }
  | {
      phase: "initial-projection"
      context: ReferencedContext
      solver: Pipeline9ClearanceProjectionSolver
    }
  | {
      phase: "initial-projection-reference" | "prepare-regions"
      context: ReferencedContext
    }
  | {
      phase: "select-region" | "publish-partial" | "prepare-independent-projection"
      context: RegionalContext
    }
  | {
      phase: "negotiate"
      negotiation: NegotiationContext
      solver: NegotiateTraceClearanceSolver
    }
  | {
      phase: "splice-region"
      negotiation: NegotiationContext
      repair: NegotiatedClearanceResult
    }
  | {
      phase: "candidate-projection"
      context: RegionalContext
      solver: Pipeline9ClearanceProjectionSolver
    }
  | ({ phase: "prepare-via-merge" } & CandidateContext)
  | ({ phase: "via-merge"; solver: Pipeline9ReportedViaMergeSolver } & CandidateContext)
  | ({ phase: "candidate-physical"; candidateReference?: DrcResult } & CandidateContext)
  | ({ phase: "candidate-reference" } & CandidateValidationContext)
  | ({ phase: "accept-candidate"; candidateReference: DrcResult } & CandidateValidationContext)
  | {
      phase: "independent-projection" | "independent-subdivision" | "independent-coupled"
      context: RegionalContext
      solver: Pipeline9ClearanceProjectionSolver
    }
  | {
      phase: "prepare-independent-subdivision" | "prepare-independent-coupled" | "independent-reference"
      context: RegionalContext
      independentRoutes: HighDensityRoute[]
    }

const REGION_SIZES = [10, 16] as const

/** Routes bounded regions through negotiation, projection and guarded publication. */
export class Pipeline9BoundedRegionalRepairSolver extends BaseSolver {
  readonly params: Pipeline9BoundedRegionalRepairParams
  readonly budget: Pipeline9BoundedRepairBudget
  private state: BoundedRepairState = { phase: "initialize" }
  private readonly result: Pipeline9BoundedRegionalRepairResult
  private reservedChildMaximum = 0

  constructor(params: Pipeline9BoundedRegionalRepairParams) {
    super()
    this.params = params
    this.budget = params.budget ?? PIPELINE9_BOUNDED_REPAIR_BUDGET
    this.result = {
      routes: params.routes,
      attemptedRegionCount: 0,
      acceptedRegionCount: 0,
      candidateAttemptCount: 0,
      pathSearchNodeCount: 0,
      referenceValidationCount: 0,
      initialDrcIssueCount: undefined,
      finalDrcIssueCount: undefined,
      publishedDrcIssueCount: undefined,
      repaired: false,
    }
    // Child solvers reserve their finite iteration bounds as each stage starts.
    this.MAX_ITERATIONS = this.budget.maxRegions * 16 + 32
  }

  private updateProgress(): void {
    const allowance = getPipeline9BoundedRepairAllowance(
      this.budget,
      this.result.acceptedRegionCount,
    )
    const negotiation =
      this.state.phase === "negotiate" ? this.state.solver : undefined
    const liveCalls =
      typeof negotiation?.stats.pathSearchCalls === "number"
        ? negotiation.stats.pathSearchCalls
        : 0
    const liveNodes =
      typeof negotiation?.stats.pathSearchNodes === "number"
        ? negotiation.stats.pathSearchNodes
        : 0
    this.stats = {
      ...this.result,
      routes: undefined,
      phase: this.state.phase,
      candidateAttemptCount: this.result.candidateAttemptCount + liveCalls,
      pathSearchNodeCount: this.result.pathSearchNodeCount + liveNodes,
      allowedRegionCount: allowance.maxRegions,
      allowedCandidateAttemptCount: allowance.maxCandidateAttempts,
      allowedPathSearchNodeCount: allowance.maxPathSearchNodes,
    }
    const consumed = Math.max(
      this.result.attemptedRegionCount / Math.max(1, this.budget.maxRegions),
      this.stats.candidateAttemptCount /
        Math.max(1, this.budget.maxCandidateAttempts),
      this.stats.pathSearchNodeCount / Math.max(1, this.budget.maxPathSearchNodes),
    )
    this.progress = this.solved
      ? 1
      : Math.max(this.progress, Math.min(0.99, consumed))
  }

  private startChild(solver: BaseSolver): void {
    if (this.activeSubSolver) {
      throw new Error("Regional repair started a child before the previous stage completed")
    }
    this.activeSubSolver = solver
    this.reservedChildMaximum = solver.MAX_ITERATIONS
    this.MAX_ITERATIONS += this.reservedChildMaximum + 1
  }

  private finish(): void {
    if (this.activeSubSolver) {
      throw new Error("Regional repair finished with an active child solver")
    }
    this.solved = true
    this.state = { phase: "done" }
  }

  private publish(context: ReferencedContext, repaired: boolean): void {
    this.result.routes = context.currentRoutes
    this.result.publishedDrcIssueCount = context.currentErrors.length
    this.result.finalDrcIssueCount = context.currentErrors.length
    this.result.repaired = repaired
    this.finish()
  }

  private initialize(): void {
    const { originalSrj, routes, syntheticConnectionNames } = this.params
    if (originalSrj.traces?.length || syntheticConnectionNames.size > 0) {
      this.finish()
      return
    }
    const clearance = Math.max(
      originalSrj.defaultObstacleMargin ?? 0.2,
      originalSrj.minTraceToPadEdgeClearance ?? 0,
      originalSrj.minTraceToHoleEdgeClearance ?? 0,
      originalSrj.minViaEdgeToPadEdgeClearance ?? 0,
    )
    let maxCopperDiameter = Math.max(
      originalSrj.minTraceWidth,
      originalSrj.minViaDiameter ?? 0,
    )
    for (const route of routes) {
      maxCopperDiameter = Math.max(
        maxCopperDiameter,
        route.traceThickness,
        route.viaDiameter,
      )
      for (const point of route.route) {
        maxCopperDiameter = Math.max(maxCopperDiameter, point.traceThickness ?? 0)
      }
    }
    // Every mutable region retains a fixed collar around its copper.
    const boundaryMargin = Math.max(0.5, maxCopperDiameter + clearance)
    const regionSizes = (this.budget.regionSizes ?? REGION_SIZES).filter(
      (size): boolean => !Number.isFinite(boundaryMargin) || boundaryMargin * 2 < size,
    )
    if (regionSizes.length === 0) {
      this.finish()
      return
    }
    this.state = {
      phase: "initial-reference",
      context: { boundaryMargin, regionSizes },
    }
  }

  private initialReference(context: InitialContext): void {
    const reference = this.params.drcEvaluator({
      traces: [],
      routes: this.params.routes,
      hdRoutes: this.params.routes,
    })
    this.result.referenceValidationCount++
    const currentErrors = Array.isArray(reference) ? reference : reference.errors
    const referenced: ReferencedContext = {
      ...context,
      currentRoutes: this.params.routes,
      reference,
      currentErrors,
      initialErrors: currentErrors,
    }
    this.result.initialDrcIssueCount = currentErrors.length
    this.result.finalDrcIssueCount = currentErrors.length
    this.result.publishedDrcIssueCount = currentErrors.length
    if (currentErrors.length === 0) {
      this.finish()
      return
    }
    const solver = new Pipeline9ClearanceProjectionSolver({
      originalSrj: this.params.originalSrj,
      routes: referenced.currentRoutes,
      drcEvaluator: (input): DrcResult => {
        this.result.referenceValidationCount++
        return this.params.drcEvaluator(input)
      },
    })
    this.state = { phase: "initial-projection", context: referenced, solver }
    this.startChild(solver)
  }

  private initialProjectionReference(context: ReferencedContext): void {
    const reference = this.params.drcEvaluator({
      traces: [],
      routes: context.currentRoutes,
      hdRoutes: context.currentRoutes,
    })
    this.result.referenceValidationCount++
    context.reference = reference
    context.currentErrors = Array.isArray(reference) ? reference : reference.errors
    this.result.finalDrcIssueCount = context.currentErrors.length
    if (context.currentErrors.length === 0) {
      this.publish(context, true)
      return
    }
    this.state = { phase: "prepare-regions", context }
  }

  private prepareRegions(context: ReferencedContext): void {
    // Normalize layer membership. Preserve pad dimensions, rotation and net aliases.
    const srj = {
      ...createSrjWithBoardValidObstacleLayers(this.params.originalSrj),
      traces: undefined,
    }
    const obstacleCenterById = new Map<string, { x: number; y: number }>()
    for (const obstacle of this.params.originalSrj.obstacles) {
      for (const id of [
        obstacle.obstacleId,
        obstacle.circuitJsonMetadata?.pcb_smtpad_id,
        obstacle.circuitJsonMetadata?.pcb_plated_hole_id,
        obstacle.connectedTo[0],
      ]) {
        if (typeof id === "string") obstacleCenterById.set(id, obstacle.center)
      }
    }
    const currentRoutes = canonicalizePipeline9HdRoutes(context.currentRoutes)
    const regional: RegionalContext = {
      ...context,
      srj,
      obstacleCenterById,
      currentRoutes,
      attemptedRegions: [],
      fixedViolations: new Map(
        getFixedObstacleViolations({ srj, routes: currentRoutes }).map(
          ({ key, severity }) => [key, severity],
        ),
      ),
    }
    this.state = { phase: "select-region", context: regional }
  }

  private selectRegion(context: RegionalContext): void {
    const allowance = getPipeline9BoundedRepairAllowance(
      this.budget,
      this.result.acceptedRegionCount,
    )
    if (
      this.result.attemptedRegionCount >= allowance.maxRegions ||
      this.result.candidateAttemptCount >= allowance.maxCandidateAttempts ||
      this.result.pathSearchNodeCount >= allowance.maxPathSearchNodes
    ) {
      this.state = { phase: "publish-partial", context }
      return
    }
    const centeredErrors = Array.isArray(context.reference)
      ? context.reference
      : (context.reference.errorsWithCenters ?? context.reference.errors)
    const centers = centeredErrors
      .map((error) => {
        // Crop around the physical pad when its display marker is far away.
        const pairPrefix = `overlap_${error.pcb_trace_id}_`
        const padId =
          typeof error.pcb_pad_id === "string"
            ? error.pcb_pad_id
            : typeof error.pcb_trace_error_id === "string" &&
                error.pcb_trace_error_id.startsWith(pairPrefix)
              ? error.pcb_trace_error_id.slice(pairPrefix.length)
              : undefined
        return (
          (padId ? context.obstacleCenterById.get(padId) : undefined) ??
          error.center ??
          error.pcb_center
        )
      })
      .filter(
        (point): point is { x: number; y: number } =>
          point !== null &&
          typeof point === "object" &&
          "x" in point &&
          "y" in point &&
          typeof point.x === "number" &&
          typeof point.y === "number" &&
          Number.isFinite(point.x) &&
          Number.isFinite(point.y),
      )
    let nextRegion: { center: { x: number; y: number }; size: number } | undefined
    for (const size of context.regionSizes) {
      const pendingCenters = centers.filter(
        ({ x, y }) =>
          !context.attemptedRegions.some(
            ({ bounds, size: attemptedSize }) =>
              size === attemptedSize &&
              x >= bounds.minX &&
              x <= bounds.maxX &&
              y >= bounds.minY &&
              y <= bounds.maxY,
          ),
      )
      const seed = pendingCenters[0]
      if (!seed) continue
      // Center nearby errors together so another repairable pad stays out of the collar.
      let minX = seed.x
      let maxX = seed.x
      let minY = seed.y
      let maxY = seed.y
      const mutableSize = size - 2 * context.boundaryMargin
      for (const point of pendingCenters.slice(1)) {
        const nextMinX = Math.min(minX, point.x)
        const nextMaxX = Math.max(maxX, point.x)
        const nextMinY = Math.min(minY, point.y)
        const nextMaxY = Math.max(maxY, point.y)
        if (
          nextMaxX - nextMinX >= mutableSize ||
          nextMaxY - nextMinY >= mutableSize
        ) continue
        minX = nextMinX
        maxX = nextMaxX
        minY = nextMinY
        maxY = nextMaxY
      }
      nextRegion = {
        center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        size,
      }
      break
    }
    if (!nextRegion) {
      this.state = { phase: "publish-partial", context }
      return
    }
    const { center, size } = nextRegion
    const region = extractRepairRegion({
      srj: context.srj,
      routes: context.currentRoutes,
      bounds: {
        minX: center.x - size / 2,
        maxX: center.x + size / 2,
        minY: center.y - size / 2,
        maxY: center.y + size / 2,
      },
    })
    context.attemptedRegions.push({ bounds: region.mutableBounds, size })
    this.result.attemptedRegionCount++
    if (region.routes.length === 0) return
    const dirtyTraceIds = new Set(context.currentErrors.flatMap(getDrcErrorTraceIds))
    const dirtyRouteIndices = region.routes.flatMap(
      (route, routeIndex): number[] =>
        [...dirtyTraceIds].some(
          (traceId): boolean =>
            traceId === route.connectionName ||
            traceId.startsWith(`${route.connectionName}_`),
        )
          ? [routeIndex]
          : [],
    )
    // Leave work for other regions when one coupled queue remains congested.
    const maxPathSearchCalls = Math.min(
      this.budget.maxCandidateAttemptsPerRegion ??
        (this.budget.revisitChangedRegions
          ? Math.ceil(allowance.maxCandidateAttempts / 2)
          : allowance.maxCandidateAttempts),
      allowance.maxCandidateAttempts - this.result.candidateAttemptCount,
    )
    const solver = new NegotiateTraceClearanceSolver({
      srj: region.srj,
      routes: region.routes,
      bounds: region.mutableBounds,
      dirtyRouteIndices,
      isLocked: (routeIndex, pointIndex): boolean =>
        region.lockedPointIndices[routeIndex]![pointIndex]!,
      maxPathSearchCalls,
      maxPathSearchNodes:
        allowance.maxPathSearchNodes - this.result.pathSearchNodeCount,
      maxPathSearchNodesPerCall: this.budget.maxPathSearchNodesPerCall,
      pathHeuristicWeight: this.budget.pathHeuristicWeight,
      pathGridSizeScale:
        context.currentErrors.length > 10 ? this.budget.pathGridSizeScale : undefined,
      allowLayerChanges: true,
      traceClearance: RELAXED_DRC_OPTIONS.traceClearance!,
      viaClearance: RELAXED_DRC_OPTIONS.viaClearance!,
      viaHoleDiameter: this.params.viaHoleDiameter,
    })
    this.state = {
      phase: "negotiate",
      negotiation: { context, allowance, maxPathSearchCalls, region },
      solver,
    }
    this.startChild(solver)
  }

  private completeNegotiation(state: Extract<BoundedRepairState, { phase: "negotiate" }>): void {
    const repair = state.solver.getOutput()
    const { context, allowance, maxPathSearchCalls } = state.negotiation
    const { pathSearchCalls: candidateAttempts, pathSearchNodes } = repair
    if (
      this.budget.revisitChangedRegions &&
      repair.unresolvedSpanCount > 0 &&
      candidateAttempts < maxPathSearchCalls &&
      pathSearchNodes < allowance.maxPathSearchNodes - this.result.pathSearchNodeCount
    ) {
      context.regionSizes.sort((a, b) => b - a)
    }
    if (
      !Number.isSafeInteger(candidateAttempts) ||
      candidateAttempts < 0 ||
      candidateAttempts + this.result.candidateAttemptCount > this.budget.maxCandidateAttempts ||
      !Number.isSafeInteger(pathSearchNodes) ||
      pathSearchNodes < 0 ||
      pathSearchNodes + this.result.pathSearchNodeCount > this.budget.maxPathSearchNodes
    ) {
      throw new Error("Pipeline9 bounded regional repair exceeded its work budget")
    }
    this.result.candidateAttemptCount += candidateAttempts
    this.result.pathSearchNodeCount += pathSearchNodes
    this.state = { phase: "splice-region", negotiation: state.negotiation, repair }
  }

  private spliceRegion(state: Extract<BoundedRepairState, { phase: "splice-region" }>): void {
    const { context, region } = state.negotiation
    const negotiatedRoutes = mergeRepairRegion({
      routes: context.currentRoutes,
      region,
      repairedRoutes: state.repair.routes,
    })
    if (negotiatedRoutes.every((route, index): boolean => route === context.currentRoutes[index])) {
      this.state = { phase: "select-region", context }
      return
    }
    const solver = new Pipeline9ClearanceProjectionSolver({
      originalSrj: this.params.originalSrj,
      routes: negotiatedRoutes,
      // The outer via guard compares the complete spliced proposal to this input.
      previousRoutes: context.currentRoutes,
      subdivideSegments: true,
      usePrecisionMargin: true,
      drcEvaluator: (input): DrcResult => {
        this.result.referenceValidationCount++
        return this.params.drcEvaluator(input)
      },
    })
    this.state = { phase: "candidate-projection", context, solver }
    this.startChild(solver)
  }

  private prepareViaMerge(state: Extract<BoundedRepairState, { phase: "prepare-via-merge" }>): void {
    if (!this.params.connMap) {
      this.state = { ...state, phase: "candidate-physical" }
      return
    }
    const solver = new Pipeline9ReportedViaMergeSolver({
      srj: state.context.srj,
      routes: state.candidateRoutes,
      connMap: this.params.connMap,
      drcEvaluator: this.params.drcEvaluator,
    })
    this.state = { ...state, phase: "via-merge", solver }
    this.startChild(solver)
  }

  private validateCandidate(state: Extract<BoundedRepairState, { phase: "candidate-physical" }>): void {
    const { context, candidateRoutes } = state
    const candidateFixedViolations = getFixedObstacleViolations({
      srj: context.srj,
      routes: candidateRoutes,
    })
    if (
      !candidateFixedViolations.every(
        ({ key, severity }): boolean =>
          context.fixedViolations.has(key) &&
          severity <= context.fixedViolations.get(key)! + 1e-8,
      ) ||
      getNewViaPadViolations({
        srj: context.srj,
        previousRoutes: context.currentRoutes,
        routes: candidateRoutes,
      }).length > 0
    ) {
      this.state = { phase: "select-region", context }
      return
    }
    this.state =
      state.candidateReference === undefined
        ? { phase: "candidate-reference", context, candidateRoutes, candidateFixedViolations }
        : {
            phase: "accept-candidate",
            context,
            candidateRoutes,
            candidateFixedViolations,
            candidateReference: state.candidateReference,
          }
  }

  private referenceCandidate(state: Extract<BoundedRepairState, { phase: "candidate-reference" }>): void {
    const candidateReference = this.params.drcEvaluator({
      traces: [],
      routes: state.candidateRoutes,
      hdRoutes: state.candidateRoutes,
    })
    this.result.referenceValidationCount++
    this.state = { ...state, phase: "accept-candidate", candidateReference }
  }

  private acceptCandidate(state: Extract<BoundedRepairState, { phase: "accept-candidate" }>): void {
    const { context, candidateReference } = state
    const candidateErrors = Array.isArray(candidateReference) ? candidateReference : candidateReference.errors
    if (candidateErrors.length >= context.currentErrors.length) {
      this.state = { phase: "select-region", context }
      return
    }
    context.currentRoutes = state.candidateRoutes
    context.currentErrors = candidateErrors
    context.reference = candidateReference
    context.fixedViolations = new Map(
      state.candidateFixedViolations.map(({ key, severity }) => [key, severity]),
    )
    this.result.acceptedRegionCount++
    // Accepted neighboring changes can reopen an already visited region.
    if (this.budget.revisitChangedRegions) context.attemptedRegions.length = 0
    this.result.finalDrcIssueCount = candidateErrors.length
    if (candidateErrors.length === 0) {
      this.publish(context, true)
      return
    }
    this.state = { phase: "select-region", context }
  }

  private publishPartial(context: RegionalContext): void {
    if (
      canPublishPartialFixedObstacleRepair({
        originalSrj: this.params.originalSrj,
        initialErrors: context.initialErrors,
        remainingErrors: context.currentErrors,
      })
    ) {
      this.publish(context, false)
      return
    }
    this.state = { phase: "prepare-independent-projection", context }
  }

  private prepareIndependentProjection(context: RegionalContext): void {
    // Private regional changes cannot leak into independent partial publication.
    const solver = new Pipeline9ClearanceProjectionSolver({
      originalSrj: this.params.originalSrj,
      routes: this.params.routes,
      allowPartialRepair: true,
      drcEvaluator: (input): DrcResult => {
        this.result.referenceValidationCount++
        return this.params.drcEvaluator(input)
      },
    })
    this.state = { phase: "independent-projection", context, solver }
    this.startChild(solver)
  }

  private prepareIndependentSubdivision(
    state: Extract<BoundedRepairState, {
      phase: "prepare-independent-subdivision" | "prepare-independent-coupled" | "independent-reference"
    }>,
  ): void {
    const solver = new Pipeline9ClearanceProjectionSolver({
      originalSrj: this.params.originalSrj,
      routes: state.independentRoutes,
      allowPartialRepair: true,
      subdivideSegments: true,
      drcEvaluator: (input): DrcResult => {
        this.result.referenceValidationCount++
        return this.params.drcEvaluator(input)
      },
    })
    this.state = { phase: "independent-subdivision", context: state.context, solver }
    this.startChild(solver)
  }

  private prepareIndependentCoupled(
    state: Extract<BoundedRepairState, {
      phase: "prepare-independent-subdivision" | "prepare-independent-coupled" | "independent-reference"
    }>,
  ): void {
    const solver = new Pipeline9ClearanceProjectionSolver({
      originalSrj: this.params.originalSrj,
      routes: state.independentRoutes,
      usePrecisionMargin: true,
      drcEvaluator: (input): DrcResult => {
        this.result.referenceValidationCount++
        return this.params.drcEvaluator(input)
      },
    })
    this.state = { phase: "independent-coupled", context: state.context, solver }
    this.startChild(solver)
  }

  private referenceIndependent(
    state: Extract<BoundedRepairState, {
      phase: "prepare-independent-subdivision" | "prepare-independent-coupled" | "independent-reference"
    }>,
  ): void {
    const reference = this.params.drcEvaluator({
      traces: [],
      routes: state.independentRoutes,
      hdRoutes: state.independentRoutes,
    })
    this.result.referenceValidationCount++
    const errors = Array.isArray(reference) ? reference : reference.errors
    this.result.routes = state.independentRoutes
    this.result.publishedDrcIssueCount = errors.length
    this.result.finalDrcIssueCount = errors.length
    this.result.repaired = errors.length === 0
    this.finish()
  }

  private completeChild(): void {
    const state = this.state
    switch (state.phase) {
      case "initial-projection": {
        const projectedRoutes = state.solver.getOutput()
        if (projectedRoutes !== state.context.currentRoutes) {
          state.context.currentRoutes = projectedRoutes
          this.state = {
            phase: "initial-projection-reference",
            context: state.context,
          }
        } else {
          this.state = { phase: "prepare-regions", context: state.context }
        }
        break
      }
      case "negotiate":
        this.completeNegotiation(state)
        break
      case "candidate-projection":
        this.state = {
          phase: "prepare-via-merge",
          context: state.context,
          candidateRoutes: state.solver.getOutput(),
        }
        break
      case "via-merge": {
        const mergeResult = state.solver.getResult()
        this.result.referenceValidationCount += mergeResult.referenceValidationCount
        this.state = {
          phase: "candidate-physical",
          context: state.context,
          candidateRoutes: mergeResult.routes,
          candidateReference: mergeResult.referenceResult,
        }
        break
      }
      case "independent-projection":
        this.state = {
          phase: "prepare-independent-subdivision",
          context: state.context,
          independentRoutes: state.solver.getOutput(),
        }
        break
      case "independent-subdivision": {
        const independentRoutes = state.solver.getOutput()
        if (independentRoutes === this.params.routes) {
          this.finish()
        } else {
          this.state = {
            phase: "prepare-independent-coupled",
            context: state.context,
            independentRoutes,
          }
        }
        break
      }
      case "independent-coupled":
        this.state = {
          phase: "independent-reference",
          context: state.context,
          independentRoutes: state.solver.getOutput(),
        }
        break
      default:
        throw new Error(`Regional repair child completed during phase ${state.phase}`)
    }
  }

  override _step(): void {
    const child = this.activeSubSolver
    if (child) {
      child.step()
      if (child.MAX_ITERATIONS > this.reservedChildMaximum) {
        this.MAX_ITERATIONS += child.MAX_ITERATIONS - this.reservedChildMaximum
        this.reservedChildMaximum = child.MAX_ITERATIONS
      }
      if (child.failed) {
        this.failed = true
        this.error = child.error
      } else if (child.solved) {
        this.activeSubSolver = null
        this.reservedChildMaximum = 0
        this.completeChild()
      }
      this.updateProgress()
      return
    }
    const state = this.state
    switch (state.phase) {
      case "initialize":
        this.initialize()
        break
      case "initial-reference":
        this.initialReference(state.context)
        break
      case "initial-projection-reference":
        this.initialProjectionReference(state.context)
        break
      case "prepare-regions":
        this.prepareRegions(state.context)
        break
      case "select-region":
        this.selectRegion(state.context)
        break
      case "splice-region":
        this.spliceRegion(state)
        break
      case "prepare-via-merge":
        this.prepareViaMerge(state)
        break
      case "candidate-physical":
        this.validateCandidate(state)
        break
      case "candidate-reference":
        this.referenceCandidate(state)
        break
      case "accept-candidate":
        this.acceptCandidate(state)
        break
      case "publish-partial":
        this.publishPartial(state.context)
        break
      case "prepare-independent-projection":
        this.prepareIndependentProjection(state.context)
        break
      case "prepare-independent-subdivision":
        this.prepareIndependentSubdivision(state)
        break
      case "prepare-independent-coupled":
        this.prepareIndependentCoupled(state)
        break
      case "independent-reference":
        this.referenceIndependent(state)
        break
      default:
        throw new Error(`Regional repair has no active child during phase ${state.phase}`)
    }
    this.updateProgress()
  }

  getResult(): Pipeline9BoundedRegionalRepairResult {
    if (!this.solved || this.failed) {
      throw new Error("Pipeline9 bounded regional repair result requested before completion")
    }
    return this.result
  }
}
