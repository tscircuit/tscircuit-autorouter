// Pinned high-density-repair03 commit e16df6c48efed49406cf45df49fd933d3141973d.
// Copyright (c) 2026 tscircuit Inc. MIT license retained in ./LICENSE.
// Original policy is resumed around ordered, immutable trial evaluation only.
import { BaseSolver } from "high-density-repair03/lib/solvers/BaseSolver"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { AutoroutingDrcEngine } from "high-density-repair03/lib/drc"
import {
  BROAD_FALLBACK_SMALL_ROUTE_LIMIT,
  EXTENDED_BROAD_FORCE_PASS_MULTIPLIER,
  LARGE_DRC_COUNT_THRESHOLD,
  MAX_DRC_COUNT_PLATEAU_CHECKS,
  MAX_LARGE_BOARD_BROAD_FALLBACK_MISSES,
  MIN_ITERATIONS_FOR_LARGE_BOARD_BROAD_FALLBACK,
  getBaseMaxIterations,
  getDrcCountImprovementCheckInterval,
  getDrcScaledMaxIterations,
  getForceScalesForEffort,
  getLargeBoardBroadFallbackCadence,
  getMaxTargetedCandidateAttemptsForEffort,
  getRouteComplexityMinIterations,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import {
  applyBroadRepulsionForces,
  applyDrcErrorForces,
  applySafeTraceLayerMoveForError,
  applyTerminalViaRelocationForError,
  applyTraceDetourForError,
  applyTraceLayerCorridorForError,
  applyTracePairSegmentDisplacementForError,
  applyTraceSpanDetourForError,
  applyTraceWaypointDetourForError,
  applyTracePairLayerMoveForError,
  applyViaOnlyDisplacementForTraceError,
  applyViaInPadLayerMoveForError,
  cloneRoutes,
  cloneRoutesForIndexes,
  getCenteredErrors,
  getDrcSnapshot,
  getTopologyRepairDrcSnapshot,
  getLegacyFirstRepairErrors,
  getNonViaPadDrcIssueCount,
  getRepairDrcIssueCount,
  getRepairDrcIssueScore,
  getTargetedClearanceSweepErrors,
  getTraceRouteIndexForError,
  getTraceRoutePairForError,
  getViaDrcIssueCount,
  isBetterDrcSnapshot,
  isDrcSnapshotCountBetter,
  isTraceObstacleDrcError,
  isViaPadDrcError,
  materializeRoutes,
  materializeRoutesForIndexes,
  SAFE_TRACE_LAYER_DIRECTION_VARIANT_COUNT,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { applyTraceToPadClearanceRelaxation } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/traceToPadClearanceRelaxation"
import { applyViaToPadClearanceRelaxation } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/viaToPadClearanceRelaxation"
import { RELAXED_DRC_OPTIONS } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/drcPresets"
import type {
  DrcEvaluator,
  DrcSnapshot,
  GlobalDrcForceImproveSolverParams,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/types"
import type { SimpleRouteJson } from "high-density-repair03/lib/types"
import type { HighDensityRoute } from "high-density-repair03/lib/types/high-density-types"
import type {
  ParallelGlobalDrcTrial,
  ParallelGlobalDrcTrialCoordinator,
  ParallelGlobalDrcTrialPlacement,
  ParallelGlobalDrcTrialResult,
} from "../parallelGlobalDrcTrialTypes"

type PreparedStep =
  | { status: "completed"; solved: boolean; failed: boolean; error: string | null }
  | { status: "exception"; exception: unknown }

type PreparedSafeLayerTrial = {
  trial: Extract<ParallelGlobalDrcTrial, { kind: "safe-trace-layer" }>
  result: ParallelGlobalDrcTrialResult
}

function reconstructTrialException(
  exception: Extract<ParallelGlobalDrcTrialPlacement, { status: "exception" }>["exception"],
): Error {
  const constructors: Record<string, new (message: string) => Error> = {
    Error, TypeError, RangeError, ReferenceError, SyntaxError, URIError, EvalError,
  }
  const constructor = Object.hasOwn(constructors, exception.name)
    ? constructors[exception.name]
    : undefined
  const error = exception.name === "AggregateError"
    ? new AggregateError([], exception.message)
    : constructor ? new constructor(exception.message) : new Error(exception.message)
  error.name = exception.name
  if (exception.stack !== undefined) error.stack = exception.stack
  return error
}

export type GlobalDrcForceImproveSolverVisualizer = (
  solver: ParallelGlobalDrcForceImproveSolver,
) => GraphicsObject

let registeredVisualizer: GlobalDrcForceImproveSolverVisualizer | undefined

export const setGlobalDrcForceImproveSolverVisualizer = (
  visualizer: GlobalDrcForceImproveSolverVisualizer,
) => {
  registeredVisualizer = visualizer
}

const TRACE_PAIR_DETOUR_GEOMETRY_VARIANTS = [0.2, 0.4, 0.8, 1.2].flatMap(
  (halfSpan) =>
    [0.2, 0.3, 0.45, 0.6].flatMap((offset) =>
      ([-1, 1] as const).map((directionSign) => ({
        halfSpan,
        offset,
        directionSign,
      })),
    ),
)

const TRACE_PAIR_DETOUR_VARIANTS = TRACE_PAIR_DETOUR_GEOMETRY_VARIANTS.flatMap(
  (variant) =>
    ([0, 1] as const).map((routeSide) => ({
      kind: "segment" as const,
      routeSide,
      ...variant,
    })),
)

const TRACE_LAYER_CORRIDOR_VARIANTS = ([1, -1] as const).flatMap(
  (normalDirectionSign) =>
    ([1, -1] as const).flatMap((tangentDirectionSign) =>
      ([false, true] as const).flatMap((reverseEndpointOffsets) =>
        ([0, 1] as const).map((routeSide) => ({
          routeSide,
          normalDirectionSign,
          tangentDirectionSign,
          reverseEndpointOffsets,
        })),
      ),
    ),
)

const TRACE_LAYER_CORRIDOR_MAX_DRC_COUNT = 8

const TRACE_PAIR_DISPLACEMENT_VARIANTS = ([0, 1] as const).map((routeSide) => ({
  kind: "displacementChain" as const,
  routeSide,
}))

const LOW_COUNT_TRACE_TOPOLOGY_VARIANTS = [
  ...TRACE_PAIR_DISPLACEMENT_VARIANTS,
  ...([-1, 1] as const).flatMap((directionSign) =>
    ([0, 1] as const).map((routeSide) => ({
      kind: "segment" as const,
      routeSide,
      halfSpan: 0.4,
      offset: 1.2,
      directionSign,
    })),
  ),
  ...([-1, 1] as const).flatMap((directionSign) =>
    ([0, 1] as const).map((routeSide) => ({
      kind: "span" as const,
      routeSide,
      spanExpansion: 3,
      offset: 1.8,
      directionSign,
    })),
  ),
  ...[
    { dx: -2.4, dy: -0.4 },
    { dx: -2.4, dy: 0.4 },
    { dx: 2.4, dy: -0.4 },
    { dx: 2.4, dy: 0.4 },
    { dx: -0.4, dy: -2.4 },
    { dx: -0.4, dy: 2.4 },
    { dx: 0.4, dy: -2.4 },
    { dx: 0.4, dy: 2.4 },
  ].flatMap((offset) =>
    ([0, 1] as const).map((routeSide) => ({
      kind: "waypoint" as const,
      routeSide,
      spanExpansion: 2,
      ...offset,
    })),
  ),
  ...[
    { dx: -0.17, dy: 0 },
    { dx: 0.17, dy: 0 },
    { dx: 0, dy: -0.17 },
    { dx: 0, dy: 0.17 },
  ].flatMap((offset) =>
    ([0, 1] as const).map((routeSide) => ({
      kind: "waypoint" as const,
      routeSide,
      spanExpansion: 0,
      ...offset,
    })),
  ),
  ...TRACE_PAIR_DETOUR_VARIANTS,
]

const SAFE_TRACE_LAYER_LOCAL_EXPANSIONS = [0, 1, 2] as const
// Reserve occasional targeted slots for different-net via pairs without
// letting them preempt the cheaper trace-topology search every iteration.
const DIFFERENT_NET_VIA_PRIORITY_INTERVAL = 8

export class ParallelGlobalDrcForceImproveSolver extends BaseSolver {
  readonly srj: SimpleRouteJson
  readonly inputHdRoutes: HighDensityRoute[]
  readonly guardedInputHdRoutes: HighDensityRoute[]
  readonly connMap?: ConnectivityMap
  readonly effort: number
  readonly drcEvaluator?: DrcEvaluator
  readonly referenceDrcEvaluator?: DrcEvaluator
  readonly autoroutingDrcEngine?: AutoroutingDrcEngine
  readonly viaHoleDiameter?: number
  readonly configuredMaxIterations?: number
  readonly enableBroadFallback: boolean
  readonly enableLargeBoardBroadFallback: boolean
  readonly enableTargetedErrorSweep: boolean
  readonly enablePostSolveClearanceRelaxation: boolean
  readonly enableSafeTraceLayerMoves: boolean
  readonly enableViaInPadLayerMoves: boolean
  readonly enableTraceViaOwnerTargeting: boolean
  outputHdRoutes: HighDensityRoute[]
  private initialDrcIssueCount: number | undefined
  private initialRepairDrcIssueCount: number | undefined
  private initialLowCountErrorsHaveMovableTraces = false
  private broadForceAccepted = false
  private targetedForceAccepted = false
  private candidateAttempts = 0
  private viaInPadCandidateAttempts = 0
  private viaInPadCandidatesAccepted = 0
  private padTopologyErrorCursor = 0
  private safeTraceLayerCursorByErrorId = new Map<string, number>()
  private traceLayerCorridorCursorByErrorId = new Map<string, number>()
  private tracePairDetourCursorByErrorId = new Map<string, number>()
  private errorCursor = 0
  private stalledIterations = 0
  private bestDrcIssueCountSeen: number | undefined
  private bestDrcIssueScoreSeen: number | undefined
  private lastDrcCountImprovementCheckIteration = 0
  private drcCountPlateauChecks = 0
  private largeBoardBroadFallbackMisses = 0
  private outputSnapshot: DrcSnapshot | undefined
  private legacyCleanCheckpoint:
    | { routes: HighDensityRoute[]; snapshot: DrcSnapshot }
    | undefined
  private viaPadRepairRolledBack = false
  private referenceInputDrcIssueCount?: number
  private referenceCandidateDrcIssueCount?: number
  private referenceCandidateRolledBack = false
  private referenceInputSnapshot?: {
    errors: Array<Record<string, unknown>>
    count: number
  }
  private inputSnapshot?: DrcSnapshot
  private preparedStep?: PreparedStep
  private preparingStep?: Promise<void>
  private nextTrialIndex = 0

  constructor(
    params: GlobalDrcForceImproveSolverParams,
    private readonly trialCoordinator: ParallelGlobalDrcTrialCoordinator,
  ) {
    super()
    this.srj = params.srj
    this.inputHdRoutes = params.hdRoutes
    this.guardedInputHdRoutes = materializeRoutes(cloneRoutes(params.hdRoutes))
    this.connMap = params.connMap
    this.effort = params.effort ?? 1
    this.drcEvaluator = params.drcEvaluator
    this.referenceDrcEvaluator = params.referenceDrcEvaluator
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
    if (
      params.viaHoleDiameter !== undefined &&
      (!Number.isFinite(params.viaHoleDiameter) || params.viaHoleDiameter <= 0)
    ) {
      throw new Error("viaHoleDiameter must be a positive finite number")
    }
    this.viaHoleDiameter = params.viaHoleDiameter
    this.configuredMaxIterations = params.maxIterations
    this.enableBroadFallback = params.enableBroadFallback ?? true
    this.enableLargeBoardBroadFallback =
      params.enableLargeBoardBroadFallback ?? true
    this.enableTargetedErrorSweep = params.enableTargetedErrorSweep ?? false
    this.enablePostSolveClearanceRelaxation =
      params.enablePostSolveClearanceRelaxation ?? true
    this.enableSafeTraceLayerMoves = params.enableSafeTraceLayerMoves ?? false
    this.enableViaInPadLayerMoves = params.enableViaInPadLayerMoves ?? false
    this.enableTraceViaOwnerTargeting =
      params.enableTraceViaOwnerTargeting ?? false
    this.outputHdRoutes = params.hdRoutes
    if (this.referenceDrcEvaluator) {
      this.referenceInputSnapshot = this.getReferenceDrcSnapshot(
        this.inputHdRoutes,
      )
    }
    this.MAX_ITERATIONS =
      this.configuredMaxIterations ?? getBaseMaxIterations(this.effort)
  }

  override getSolverName(): string {
    // Preserve the pinned solver's phase labels and named BaseSolver errors.
    // This class changes evaluation placement, not the force policy identity.
    const originalSolverName = "GlobalDrcForceImproveSolver"
    return originalSolverName
  }

  async prepareForNextStep(): Promise<void> {
    if (this.solved || this.failed || this.preparedStep) return
    if (this.preparingStep) {
      await this.preparingStep
      return
    }
    const preparation = this.prepareNativeStep()
    this.preparingStep = preparation
    try {
      await preparation
    } finally {
      if (this.preparingStep === preparation) this.preparingStep = undefined
    }
  }

  async solveAsync(): Promise<void> {
    while (!this.solved && !this.failed) {
      await this.prepareForNextStep()
      this.step()
    }
  }

  private async prepareNativeStep(): Promise<void> {
    const iterations = this.iterations
    const solved = this.solved
    const failed = this.failed
    const error = this.error
    this.iterations = iterations + 1
    try {
      const iterator = this._iterateStep()
      let next = iterator.next()
      while (!next.done) {
        const trials = next.value
        const results = await this.trialCoordinator.dispatch(trials)
        next = iterator.next(results)
      }
      this.preparedStep = {
        status: "completed", solved: this.solved, failed: this.failed, error: this.error,
      }
    } catch (exception: unknown) {
      this.preparedStep = { status: "exception", exception }
    } finally {
      this.iterations = iterations
      this.solved = solved
      this.failed = failed
      this.error = error
    }
  }

  private getTrialConnectivity(): ParallelGlobalDrcTrial["connectivity"] {
    if (!this.connMap) return undefined
    return {
      connectivityNetMap: this.connMap.netMap,
      connectivityIdToNetMap: this.connMap.idToNetMap,
    }
  }

  private correlateTrialResults(
    trials: ParallelGlobalDrcTrial[],
    results: ParallelGlobalDrcTrialResult[],
  ): Map<number, ParallelGlobalDrcTrialResult> {
    if (results.length !== trials.length) {
      throw new Error("Parallel global force received an incomplete trial batch")
    }
    const expected = new Map(trials.map((trial) => [trial.trialIndex, trial]))
    const correlated = new Map<number, ParallelGlobalDrcTrialResult>()
    for (const result of results) {
      const trial = expected.get(result.trialIndex)
      if (result.kind !== "globalDrcForceTrial" || !trial || correlated.has(result.trialIndex)) {
        throw new Error("Parallel global force received an invalid trial result")
      }
      const expectedPlacements = trial.kind === "force-scale" ? 1 : 2
      if (result.placements.length !== expectedPlacements &&
          !(trial.kind === "safe-trace-layer" && result.placements.length === 1 &&
            result.placements[0]!.status === "exception" &&
            !result.placements[0]!.countedBeforeException)) {
        throw new Error("Parallel global force received an invalid placement count")
      }
      correlated.set(result.trialIndex, result)
    }
    return correlated
  }

  private getPreparedTrialSnapshot(
    placement: Extract<ParallelGlobalDrcTrialPlacement,
      { status: "evaluated" } | { status: "exception"; countedBeforeException: true }>,
  ): DrcSnapshot {
    if (placement.status === "exception") {
      this.trialCoordinator.adoptException(placement, reconstructTrialException(placement.exception))
    } else {
      this.trialCoordinator.adopt(placement)
    }
    try {
      return this.getSnapshot(placement.routes)
    } finally {
      this.trialCoordinator.discardPreparedEvaluation?.()
    }
  }

  override _step(): void {
    const prepared = this.preparedStep
    if (!prepared) throw new Error("Parallel global force requires prepareForNextStep()")
    this.preparedStep = undefined
    if (prepared.status === "exception") throw prepared.exception
    this.solved = prepared.solved
    this.failed = prepared.failed
    this.error = prepared.error
  }

  override getConstructorParams(): readonly [GlobalDrcForceImproveSolverParams] {
    return [
      {
        srj: this.srj,
        hdRoutes: this.inputHdRoutes,
        connMap: this.connMap,
        effort: this.effort,
        drcEvaluator: this.drcEvaluator,
        referenceDrcEvaluator: this.referenceDrcEvaluator,
        autoroutingDrcEngine: this.autoroutingDrcEngine,
        viaHoleDiameter: this.viaHoleDiameter,
        maxIterations: this.configuredMaxIterations,
        enableBroadFallback: this.enableBroadFallback,
        enableLargeBoardBroadFallback: this.enableLargeBoardBroadFallback,
        enableTargetedErrorSweep: this.enableTargetedErrorSweep,
        enablePostSolveClearanceRelaxation:
          this.enablePostSolveClearanceRelaxation,
        enableSafeTraceLayerMoves: this.enableSafeTraceLayerMoves,
        enableViaInPadLayerMoves: this.enableViaInPadLayerMoves,
        enableTraceViaOwnerTargeting: this.enableTraceViaOwnerTargeting,
      },
    ] as const
  }

  private updateStats(snapshot: DrcSnapshot) {
    this.stats = {
      initialDrcIssueCount: this.initialDrcIssueCount ?? snapshot.count,
      finalDrcIssueCount: snapshot.count,
      globalDrcForceImproveMaxIterations: this.MAX_ITERATIONS,
      globalDrcForceImproveBroadForceAccepted: this.broadForceAccepted,
      globalDrcForceImproveTargetedForceAccepted: this.targetedForceAccepted,
      globalDrcForceImproveCandidateAttempts: this.candidateAttempts,
      globalDrcForceImproveViaInPadCandidateAttempts:
        this.viaInPadCandidateAttempts,
      globalDrcForceImproveViaInPadCandidatesAccepted:
        this.viaInPadCandidatesAccepted,
      globalDrcForceImproveStalledIterations: this.stalledIterations,
      globalDrcForceImproveBestDrcIssueCountSeen:
        this.bestDrcIssueCountSeen ?? snapshot.count,
      globalDrcForceImproveBestDrcIssueScoreSeen:
        this.bestDrcIssueScoreSeen ?? snapshot.issueScore,
      globalDrcForceImproveDrcCountPlateauChecks: this.drcCountPlateauChecks,
      globalDrcForceImproveLargeBoardBroadFallbackMisses:
        this.largeBoardBroadFallbackMisses,
      globalDrcForceImproveViaPadRepairRolledBack: this.viaPadRepairRolledBack,
      globalDrcForceImproveReferenceInputDrcIssueCount:
        this.referenceInputDrcIssueCount,
      globalDrcForceImproveReferenceCandidateDrcIssueCount:
        this.referenceCandidateDrcIssueCount,
      globalDrcForceImproveReferenceCandidateRolledBack:
        this.referenceCandidateRolledBack,
    }
  }

  private finishAtLegacyCleanCheckpoint() {
    const checkpoint = this.legacyCleanCheckpoint
    if (!checkpoint) return false
    this.outputHdRoutes = checkpoint.routes
    this.outputSnapshot = checkpoint.snapshot
    this.viaPadRepairRolledBack = true
    this.updateStats(checkpoint.snapshot)
    this.solved = true
    return true
  }

  private increaseMaxIterationsForDrcIssueCount(drcIssueCount: number) {
    if (this.configuredMaxIterations !== undefined) {
      this.MAX_ITERATIONS = this.configuredMaxIterations
      return
    }

    this.MAX_ITERATIONS = Math.max(
      this.MAX_ITERATIONS,
      getDrcScaledMaxIterations(drcIssueCount, this.effort),
      getRouteComplexityMinIterations(this.inputHdRoutes.length, drcIssueCount),
    )
  }

  private getSnapshot(routes: HighDensityRoute[]) {
    const createSnapshot = this.initialLowCountErrorsHaveMovableTraces
      ? getTopologyRepairDrcSnapshot
      : getDrcSnapshot
    return createSnapshot(
      this.srj,
      routes,
      this.drcEvaluator,
      this.connMap,
      this.autoroutingDrcEngine,
    )
  }

  private getReferenceDrcSnapshot(routes: HighDensityRoute[]) {
    const evaluatorInput = {
      traces: [],
      srj: this.srj,
      routes,
      hdRoutes: routes,
    }
    const cachedResult =
      this.referenceDrcEvaluator?.getCachedResult?.(evaluatorInput)
    if (cachedResult) {
      const errors = Array.isArray(cachedResult)
        ? cachedResult
        : cachedResult.errors
      return { errors, count: errors.length }
    }
    return getDrcSnapshot(
      this.srj,
      routes,
      this.referenceDrcEvaluator,
      this.connMap,
      this.autoroutingDrcEngine,
    )
  }

  private getViaIssueCount(snapshot: DrcSnapshot) {
    return getViaDrcIssueCount(snapshot)
  }

  private getRepairIssueCount(snapshot: DrcSnapshot) {
    return getRepairDrcIssueCount(snapshot)
  }

  private getRepairIssueScore(snapshot: DrcSnapshot) {
    return getRepairDrcIssueScore(snapshot)
  }

  private acceptSolvedRoutes(
    routes: HighDensityRoute[],
    snapshot: DrcSnapshot,
  ) {
    const traceRelaxedRoutes = this.enablePostSolveClearanceRelaxation
      ? applyTraceToPadClearanceRelaxation(this.srj, routes, this.connMap)
      : routes
    const relaxedRoutes = this.enablePostSolveClearanceRelaxation
      ? applyViaToPadClearanceRelaxation(
          this.srj,
          traceRelaxedRoutes,
          this.connMap,
        )
      : routes
    const relaxedSnapshot =
      relaxedRoutes === routes ? snapshot : this.getSnapshot(relaxedRoutes)

    const relaxedSnapshotIsNoWorse =
      relaxedSnapshot.count < snapshot.count ||
      (relaxedSnapshot.count === snapshot.count &&
        relaxedSnapshot.issueScore <= snapshot.issueScore)
    let acceptedRoutes = relaxedSnapshotIsNoWorse ? relaxedRoutes : routes
    let acceptedSnapshot = relaxedSnapshotIsNoWorse ? relaxedSnapshot : snapshot
    const inputSnapshot =
      this.inputSnapshot ?? this.getSnapshot(this.guardedInputHdRoutes)
    if (this.referenceDrcEvaluator) {
      const referenceInputSnapshot = this.referenceInputSnapshot!
      const referenceCandidateSnapshot =
        this.getReferenceDrcSnapshot(acceptedRoutes)
      this.referenceInputDrcIssueCount = referenceInputSnapshot.count
      this.referenceCandidateDrcIssueCount = referenceCandidateSnapshot.count
      if (referenceCandidateSnapshot.count > referenceInputSnapshot.count) {
        acceptedRoutes = this.guardedInputHdRoutes
        acceptedSnapshot = inputSnapshot
        this.referenceCandidateRolledBack = true
      }
    }
    this.outputHdRoutes = acceptedRoutes
    this.outputSnapshot = acceptedSnapshot
    this.stalledIterations = 0
    this.updateStats(acceptedSnapshot)
    this.solved = true
  }

  private updateDrcCountPlateauState(snapshot: DrcSnapshot) {
    const repairIssueCount = this.getRepairIssueCount(snapshot)
    const repairIssueScore = this.getRepairIssueScore(snapshot)
    this.bestDrcIssueCountSeen ??= repairIssueCount
    this.bestDrcIssueScoreSeen ??= repairIssueScore
    const initialDrcIssueCount =
      this.initialRepairDrcIssueCount ?? repairIssueCount
    const isLargeRouteBoard =
      this.inputHdRoutes.length > BROAD_FALLBACK_SMALL_ROUTE_LIMIT &&
      initialDrcIssueCount > 0
    const needsLargeBoardBroadFallbackWindow = isLargeRouteBoard

    if (
      (initialDrcIssueCount >= LARGE_DRC_COUNT_THRESHOLD ||
        needsLargeBoardBroadFallbackWindow) &&
      this.iterations < MIN_ITERATIONS_FOR_LARGE_BOARD_BROAD_FALLBACK
    ) {
      if (
        repairIssueCount < this.bestDrcIssueCountSeen ||
        (repairIssueCount === this.bestDrcIssueCountSeen &&
          repairIssueScore < this.bestDrcIssueScoreSeen)
      ) {
        this.bestDrcIssueCountSeen = repairIssueCount
        this.bestDrcIssueScoreSeen = repairIssueScore
      }
      if (
        isLargeRouteBoard &&
        this.largeBoardBroadFallbackMisses >=
          MAX_LARGE_BOARD_BROAD_FALLBACK_MISSES
      ) {
        this.solved = true
      }
      return
    }

    const improvementCheckInterval =
      getDrcCountImprovementCheckInterval(initialDrcIssueCount)

    if (
      this.iterations - this.lastDrcCountImprovementCheckIteration <
      improvementCheckInterval
    ) {
      return
    }

    this.lastDrcCountImprovementCheckIteration = this.iterations
    if (
      repairIssueCount < this.bestDrcIssueCountSeen ||
      (repairIssueCount === this.bestDrcIssueCountSeen &&
        repairIssueScore < this.bestDrcIssueScoreSeen)
    ) {
      this.bestDrcIssueCountSeen = repairIssueCount
      this.bestDrcIssueScoreSeen = repairIssueScore
      this.drcCountPlateauChecks = 0
      return
    }

    this.drcCountPlateauChecks += 1
    if (this.drcCountPlateauChecks >= MAX_DRC_COUNT_PLATEAU_CHECKS) {
      this.solved = true
    }
  }

  protected *_iterateStep(): Generator<
    ParallelGlobalDrcTrial[], void, ParallelGlobalDrcTrialResult[]
  > {
    let bestRoutes = this.outputHdRoutes
    let bestSnapshot = this.outputSnapshot ?? this.getSnapshot(bestRoutes)
    const nonViaPadIssueCount = getNonViaPadDrcIssueCount(bestSnapshot)
    if (this.legacyCleanCheckpoint && nonViaPadIssueCount > 0) {
      this.finishAtLegacyCleanCheckpoint()
      return
    }
    if (
      !this.legacyCleanCheckpoint &&
      nonViaPadIssueCount === 0 &&
      bestSnapshot.errors.some(isViaPadDrcError)
    ) {
      this.legacyCleanCheckpoint = {
        routes: materializeRoutes(cloneRoutes(bestRoutes)),
        snapshot: bestSnapshot,
      }
    }
    if (this.initialDrcIssueCount === undefined) {
      this.inputSnapshot = bestSnapshot
      this.initialDrcIssueCount = bestSnapshot.count
      this.initialRepairDrcIssueCount = this.getRepairIssueCount(bestSnapshot)
      const initialRepairErrors = getLegacyFirstRepairErrors(
        bestSnapshot.errors,
      )
      this.initialLowCountErrorsHaveMovableTraces =
        this.initialRepairDrcIssueCount > 0 &&
        this.initialRepairDrcIssueCount <= 3 &&
        initialRepairErrors.every(
          (error) =>
            getTraceRouteIndexForError(
              error,
              bestSnapshot.traceRouteIndexById,
            ) !== undefined,
        )
      if (this.initialLowCountErrorsHaveMovableTraces) {
        bestSnapshot = this.getSnapshot(bestRoutes)
      }
      this.bestDrcIssueCountSeen = this.getRepairIssueCount(bestSnapshot)
      this.bestDrcIssueScoreSeen = this.getRepairIssueScore(bestSnapshot)
      this.increaseMaxIterationsForDrcIssueCount(
        this.getRepairIssueCount(bestSnapshot),
      )
    }

    if (bestSnapshot.count === 0) {
      this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
      return
    }

    let bestIssueCount = this.getRepairIssueCount(bestSnapshot)
    let bestIssueScore = this.getRepairIssueScore(bestSnapshot)
    let bestViaIssueCount = this.getViaIssueCount(bestSnapshot)
    const centeredErrors = getCenteredErrors(bestSnapshot.errors)
    if (centeredErrors.length === 0) {
      this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
      return
    }

    const maxCandidateAttemptsThisStep =
      getMaxTargetedCandidateAttemptsForEffort(this.effort)
    let candidateAttemptsThisStep = 0
    let safeTraceLayerCandidateAttemptsThisStep = 0
    let tracePairDetourAttemptedThisStep = false
    let acceptedCandidate = false
    let attemptedPeriodicLargeBoardBroadFallback = false
    const activeRepairErrors = getLegacyFirstRepairErrors(centeredErrors)
    const sameNetViaError = this.enableTargetedErrorSweep
      ? activeRepairErrors.find(
          (error) =>
            error.type === "pcb_via_clearance_error" &&
            error.pcb_via_pair_net_relation === "same_net",
        )
      : undefined
    const shouldPrioritizeDifferentNetVia =
      this.enableTargetedErrorSweep &&
      (this.iterations - 1) % DIFFERENT_NET_VIA_PRIORITY_INTERVAL === 0
    const prioritizedViaError =
      sameNetViaError ??
      (shouldPrioritizeDifferentNetVia
        ? activeRepairErrors.find(
            (error) => error.type === "pcb_via_clearance_error",
          )
        : undefined)
    const prioritizedErrors = prioritizedViaError
      ? [
          prioritizedViaError,
          ...activeRepairErrors.filter(
            (error) => error !== prioritizedViaError,
          ),
        ]
      : activeRepairErrors
    const maxErrorsThisStep = Math.min(
      prioritizedErrors.length,
      Math.max(1, Math.ceil(this.effort)),
    )
    const startErrorIndex = prioritizedViaError
      ? 0
      : this.errorCursor % prioritizedErrors.length

    const targetedSweepErrors = this.enableTargetedErrorSweep
      ? getTargetedClearanceSweepErrors(centeredErrors, this.effort)
      : []
    const shouldTryTracePairTopology =
      bestIssueCount <= 1 || this.initialLowCountErrorsHaveMovableTraces
    const shouldTryTraceLayerCorridor =
      !this.initialLowCountErrorsHaveMovableTraces &&
      bestIssueCount <= TRACE_LAYER_CORRIDOR_MAX_DRC_COUNT &&
      this.srj.layerCount > 1
    const padTraceErrors = prioritizedViaError
      ? []
      : centeredErrors.filter(
          (error) =>
            error.type === "pcb_pad_trace_clearance_error" ||
            ((this.enableSafeTraceLayerMoves ||
              shouldTryTracePairTopology ||
              shouldTryTraceLayerCorridor) &&
              error.type === "pcb_trace_error"),
        )
    const orderedPadTopologyErrors = padTraceErrors.map(
      (_, offset) =>
        padTraceErrors[
          (this.padTopologyErrorCursor + offset) % padTraceErrors.length
        ]!,
    )
    for (const error of this.enableSafeTraceLayerMoves ||
    this.enableViaInPadLayerMoves
      ? orderedPadTopologyErrors
      : []) {
      const safeTraceLayerBudgetExhausted =
        !this.enableSafeTraceLayerMoves ||
        safeTraceLayerCandidateAttemptsThisStep >= maxCandidateAttemptsThisStep
      const viaInPadBudgetExhausted =
        !this.enableViaInPadLayerMoves ||
        candidateAttemptsThisStep >= maxCandidateAttemptsThisStep
      if (
        acceptedCandidate ||
        (safeTraceLayerBudgetExhausted && viaInPadBudgetExhausted)
      ) {
        break
      }

      this.padTopologyErrorCursor =
        (padTraceErrors.indexOf(error) + 1) % padTraceErrors.length

      let bestTopologyCandidate:
        | {
            routes: HighDensityRoute[]
            snapshot: DrcSnapshot
            viaIssueCount: number
            usesViaInPad: boolean
          }
        | undefined
      const traceErrorKey =
        typeof error.pcb_trace_error_id === "string"
          ? error.pcb_trace_error_id
          : typeof error.pcb_trace_id === "string"
            ? error.pcb_trace_id
            : undefined
      const traceRouteIndex = getTraceRouteIndexForError(
        error,
        bestSnapshot.traceRouteIndexById,
      )
      const traceRoutePair = getTraceRoutePairForError(
        error,
        bestSnapshot.traceRouteIndexById,
      )
      if (
        this.enableTraceViaOwnerTargeting &&
        traceRouteIndex !== undefined &&
        Array.isArray(error.pcb_via_ids) &&
        error.pcb_via_ids.length === 1 &&
        candidateAttemptsThisStep < maxCandidateAttemptsThisStep
      ) {
        const candidateRoutes = cloneRoutes(bestRoutes)
        if (
          applyViaOnlyDisplacementForTraceError(
            this.srj,
            candidateRoutes,
            error,
            bestSnapshot.traceRouteIndexById,
            traceRouteIndex,
            this.connMap,
          )
        ) {
          const routes = materializeRoutes(candidateRoutes)
          const snapshot = this.getSnapshot(routes)
          const viaIssueCount = this.getViaIssueCount(snapshot)
          candidateAttemptsThisStep += 1
          this.candidateAttempts += 1
          if (
            viaIssueCount <= bestViaIssueCount &&
            isDrcSnapshotCountBetter(snapshot, bestSnapshot)
          ) {
            bestTopologyCandidate = {
              routes,
              snapshot,
              viaIssueCount,
              usesViaInPad: false,
            }
          }
        }
      }
      if (this.enableSafeTraceLayerMoves && traceRouteIndex !== undefined) {
        const safeRouteIndexes = traceRoutePair ?? [traceRouteIndex]
        const localSpanVariantCount =
          safeRouteIndexes.length *
          this.srj.layerCount *
          SAFE_TRACE_LAYER_LOCAL_EXPANSIONS.length
        const fullSpanVariantCount =
          safeRouteIndexes.length *
          this.srj.layerCount *
          SAFE_TRACE_LAYER_DIRECTION_VARIANT_COUNT
        const variantCount = localSpanVariantCount + fullSpanVariantCount
        const prioritizeFullSpan = isTraceObstacleDrcError(error)
        const fullSpanVariantOffset = prioritizeFullSpan
          ? 0
          : localSpanVariantCount
        const localSpanVariantOffset = prioritizeFullSpan
          ? fullSpanVariantCount
          : 0
        let safeTraceLayerCursor = traceErrorKey
          ? (this.safeTraceLayerCursorByErrorId.get(traceErrorKey) ?? 0)
          : 0
        let variantsChecked = 0
        let preparedSafeLayerTrials: PreparedSafeLayerTrial[] = []
        while (
          safeTraceLayerCandidateAttemptsThisStep <
            maxCandidateAttemptsThisStep &&
          variantsChecked < variantCount
        ) {
          if (preparedSafeLayerTrials.length === 0) {
            const batchSize = Math.min(
              4,
              maxCandidateAttemptsThisStep - safeTraceLayerCandidateAttemptsThisStep,
              variantCount - variantsChecked,
            )
            const trials: Array<Extract<ParallelGlobalDrcTrial, { kind: "safe-trace-layer" }>> = []
            for (let offset = 0; offset < batchSize; offset++) {
              const variantIndex = (safeTraceLayerCursor + offset) % variantCount
              const isFullSpan =
                variantIndex >= fullSpanVariantOffset &&
                variantIndex < fullSpanVariantOffset + fullSpanVariantCount
              const modeVariantIndex =
                variantIndex - (isFullSpan ? fullSpanVariantOffset : localSpanVariantOffset)
              const routeSide = modeVariantIndex % safeRouteIndexes.length
              const layerVariant = Math.floor(modeVariantIndex / safeRouteIndexes.length)
              const targetZ = layerVariant % this.srj.layerCount
              const spanExpansion = isFullSpan
                ? ("full" as const)
                : SAFE_TRACE_LAYER_LOCAL_EXPANSIONS[
                    Math.floor(layerVariant / this.srj.layerCount) %
                      SAFE_TRACE_LAYER_LOCAL_EXPANSIONS.length
                  ]!
              const directionVariant = isFullSpan
                ? Math.floor(layerVariant / this.srj.layerCount)
                : 0
              trials.push({
                kind: "safe-trace-layer", trialIndex: this.nextTrialIndex++,
                srj: this.srj, hdRoutes: bestRoutes, error,
                connectivity: this.getTrialConnectivity(),
                changedRouteIndex: safeRouteIndexes[routeSide]!,
                targetZ, spanExpansion, directionVariant,
              })
            }
            const results = this.correlateTrialResults(trials, yield trials)
            preparedSafeLayerTrials = trials.map((trial) => ({
              trial, result: results.get(trial.trialIndex)!,
            }))
          }
          const prepared = preparedSafeLayerTrials.shift()!
          safeTraceLayerCursor = (safeTraceLayerCursor + 1) % variantCount
          variantsChecked += 1
          // Placements retain native false/true order before a direction counts.
          let evaluatedDirection = false
          for (const placement of prepared.result.placements) {
            if (placement.status === "unchanged") continue
            if (placement.status === "exception" && !placement.countedBeforeException) {
              throw reconstructTrialException(placement.exception)
            }
            const materializedCandidateRoutes = placement.routes
            evaluatedDirection = true
            this.candidateAttempts += 1
            const candidateSnapshot = this.getPreparedTrialSnapshot(placement)
            const candidateViaIssueCount =
              this.getViaIssueCount(candidateSnapshot)
            const comparisonSnapshot =
              bestTopologyCandidate?.snapshot ?? bestSnapshot
            const comparisonViaIssueCount =
              bestTopologyCandidate?.viaIssueCount ?? bestViaIssueCount

            if (
              candidateViaIssueCount <= comparisonViaIssueCount &&
              (isDrcSnapshotCountBetter(
                candidateSnapshot,
                comparisonSnapshot,
              ) ||
                (bestTopologyCandidate !== undefined &&
                  getRepairDrcIssueCount(candidateSnapshot) ===
                    getRepairDrcIssueCount(comparisonSnapshot) &&
                  candidateSnapshot.count < comparisonSnapshot.count))
            ) {
              bestTopologyCandidate = {
                routes: materializedCandidateRoutes,
                snapshot: candidateSnapshot,
                viaIssueCount: candidateViaIssueCount,
                usesViaInPad: false,
              }
            }
          }
          if (evaluatedDirection) safeTraceLayerCandidateAttemptsThisStep += 1
        }
        if (traceErrorKey) {
          this.safeTraceLayerCursorByErrorId.set(
            traceErrorKey,
            safeTraceLayerCursor,
          )
        }
      }
      if (
        this.enableSafeTraceLayerMoves &&
        shouldTryTraceLayerCorridor &&
        traceErrorKey &&
        traceRoutePair
      ) {
        let corridorCursor =
          this.traceLayerCorridorCursorByErrorId.get(traceErrorKey) ?? 0
        let corridorVariantsChecked = 0
        while (
          candidateAttemptsThisStep < maxCandidateAttemptsThisStep &&
          corridorVariantsChecked < TRACE_LAYER_CORRIDOR_VARIANTS.length
        ) {
          const variant =
            TRACE_LAYER_CORRIDOR_VARIANTS[
              corridorCursor % TRACE_LAYER_CORRIDOR_VARIANTS.length
            ]!
          corridorCursor += 1
          corridorVariantsChecked += 1
          const changedRouteIndex = traceRoutePair[variant.routeSide]
          const originalZ = bestRoutes[changedRouteIndex]?.route[0]?.z
          if (originalZ === undefined) continue
          const targetZ = (originalZ + 1) % this.srj.layerCount
          const candidateRoutes = cloneRoutesForIndexes(bestRoutes, [
            changedRouteIndex,
          ])
          const changed = applyTraceLayerCorridorForError(
            this.srj,
            candidateRoutes,
            error,
            changedRouteIndex,
            targetZ,
            variant.normalDirectionSign,
            variant.tangentDirectionSign,
            variant.reverseEndpointOffsets,
          )
          if (!changed) continue

          const materializedCandidateRoutes = materializeRoutesForIndexes(
            candidateRoutes,
            [changedRouteIndex],
          )
          candidateAttemptsThisStep += 1
          this.candidateAttempts += 1
          const candidateSnapshot = this.getSnapshot(
            materializedCandidateRoutes,
          )
          const candidateViaIssueCount =
            this.getViaIssueCount(candidateSnapshot)
          const comparisonSnapshot =
            bestTopologyCandidate?.snapshot ?? bestSnapshot
          const comparisonViaIssueCount =
            bestTopologyCandidate?.viaIssueCount ?? bestViaIssueCount
          if (
            candidateViaIssueCount <= comparisonViaIssueCount &&
            isDrcSnapshotCountBetter(candidateSnapshot, comparisonSnapshot)
          ) {
            bestTopologyCandidate = {
              routes: materializedCandidateRoutes,
              snapshot: candidateSnapshot,
              viaIssueCount: candidateViaIssueCount,
              usesViaInPad: false,
            }
          }
        }
        this.traceLayerCorridorCursorByErrorId.set(
          traceErrorKey,
          corridorCursor,
        )
      }
      if (
        this.enableSafeTraceLayerMoves &&
        traceErrorKey &&
        ((this.initialLowCountErrorsHaveMovableTraces &&
          (traceRoutePair || traceRouteIndex !== undefined)) ||
          (!this.initialLowCountErrorsHaveMovableTraces && traceRoutePair))
      ) {
        const traceTopologyVariants = this
          .initialLowCountErrorsHaveMovableTraces
          ? LOW_COUNT_TRACE_TOPOLOGY_VARIANTS
          : shouldTryTracePairTopology
            ? [
                ...TRACE_PAIR_DISPLACEMENT_VARIANTS,
                ...TRACE_PAIR_DETOUR_VARIANTS,
              ]
            : TRACE_PAIR_DISPLACEMENT_VARIANTS
        const detourRouteIndexes = traceRoutePair ?? [traceRouteIndex!]
        let detourCursor =
          this.tracePairDetourCursorByErrorId.get(traceErrorKey) ?? 0
        let detourVariantsChecked = 0
        while (
          candidateAttemptsThisStep < maxCandidateAttemptsThisStep &&
          detourVariantsChecked < traceTopologyVariants.length
        ) {
          const variant =
            traceTopologyVariants[detourCursor % traceTopologyVariants.length]!
          detourCursor += 1
          detourVariantsChecked += 1
          const changedRouteIndex = detourRouteIndexes[variant.routeSide]
          if (changedRouteIndex === undefined) continue
          const topologyError =
            this.initialLowCountErrorsHaveMovableTraces &&
            error.worst_contact_center
              ? {
                  ...error,
                  center: error.worst_contact_center,
                  message: error.worst_contact_message ?? error.message,
                  actual_clearance:
                    error.worst_actual_clearance ?? error.actual_clearance,
                }
              : error
          if (variant.kind === "displacementChain") {
            const chainCandidateRoutes = cloneRoutes(bestRoutes)
            const displacement = applyTracePairSegmentDisplacementForError(
              this.srj,
              chainCandidateRoutes,
              topologyError,
              bestSnapshot.traceRouteIndexById,
              variant.routeSide,
            )
            if (!displacement) continue

            tracePairDetourAttemptedThisStep = true
            candidateAttemptsThisStep += 1
            this.candidateAttempts += 1
            let materializedChainRoutes =
              materializeRoutes(chainCandidateRoutes)
            let chainSnapshot = this.getSnapshot(materializedChainRoutes)
            let chainViaIssueCount = this.getViaIssueCount(chainSnapshot)
            let chainIssueCount = this.getRepairIssueCount(chainSnapshot)

            if (
              chainIssueCount > 0 &&
              candidateAttemptsThisStep < maxCandidateAttemptsThisStep
            ) {
              const propagatedRoutes = cloneRoutes(materializedChainRoutes)
              let propagated = false
              for (const chainError of chainSnapshot.errors) {
                propagated =
                  applyViaOnlyDisplacementForTraceError(
                    this.srj,
                    propagatedRoutes,
                    chainError,
                    chainSnapshot.traceRouteIndexById,
                    displacement.movedRouteIndex,
                    this.connMap,
                  ) || propagated
              }
              if (propagated) {
                candidateAttemptsThisStep += 1
                this.candidateAttempts += 1
                const materializedPropagatedRoutes =
                  materializeRoutes(propagatedRoutes)
                const propagatedSnapshot = this.getSnapshot(
                  materializedPropagatedRoutes,
                )
                const propagatedViaIssueCount =
                  this.getViaIssueCount(propagatedSnapshot)
                if (
                  isBetterDrcSnapshot(
                    propagatedSnapshot,
                    propagatedViaIssueCount,
                    chainIssueCount,
                    this.getRepairIssueScore(chainSnapshot),
                    chainViaIssueCount,
                    chainSnapshot,
                  )
                ) {
                  materializedChainRoutes = materializedPropagatedRoutes
                  chainSnapshot = propagatedSnapshot
                  chainViaIssueCount = propagatedViaIssueCount
                  chainIssueCount = this.getRepairIssueCount(chainSnapshot)
                }
              }
            }

            const comparisonCount = bestTopologyCandidate
              ? this.getRepairIssueCount(bestTopologyCandidate.snapshot)
              : bestIssueCount
            const comparisonScore = bestTopologyCandidate
              ? this.getRepairIssueScore(bestTopologyCandidate.snapshot)
              : bestIssueScore
            const comparisonViaIssueCount =
              bestTopologyCandidate?.viaIssueCount ?? bestViaIssueCount
            if (
              chainViaIssueCount <= comparisonViaIssueCount &&
              isBetterDrcSnapshot(
                chainSnapshot,
                chainViaIssueCount,
                comparisonCount,
                comparisonScore,
                comparisonViaIssueCount,
                bestTopologyCandidate?.snapshot ?? bestSnapshot,
              )
            ) {
              bestTopologyCandidate = {
                routes: materializedChainRoutes,
                snapshot: chainSnapshot,
                viaIssueCount: chainViaIssueCount,
                usesViaInPad: false,
              }
            }
            if (chainIssueCount === 0) break
            continue
          }
          const candidateRoutes = cloneRoutesForIndexes(bestRoutes, [
            changedRouteIndex,
          ])
          const changed =
            variant.kind === "segment"
              ? applyTraceDetourForError(
                  candidateRoutes,
                  topologyError,
                  changedRouteIndex,
                  variant.halfSpan,
                  variant.offset,
                  variant.directionSign,
                )
              : variant.kind === "span"
                ? applyTraceSpanDetourForError(
                    this.srj,
                    candidateRoutes,
                    topologyError,
                    changedRouteIndex,
                    variant.spanExpansion,
                    variant.offset,
                    variant.directionSign,
                  )
                : applyTraceWaypointDetourForError(
                    this.srj,
                    candidateRoutes,
                    topologyError,
                    changedRouteIndex,
                    variant.spanExpansion,
                    {
                      x:
                        (topologyError.center as { x: number; y: number }).x +
                        variant.dx,
                      y:
                        (topologyError.center as { x: number; y: number }).y +
                        variant.dy,
                    },
                  )
          if (!changed) continue

          const materializedCandidateRoutes = materializeRoutesForIndexes(
            candidateRoutes,
            [changedRouteIndex],
          )
          tracePairDetourAttemptedThisStep = true
          candidateAttemptsThisStep += 1
          this.candidateAttempts += 1
          const candidateSnapshot = this.getSnapshot(
            materializedCandidateRoutes,
          )
          const candidateViaIssueCount =
            this.getViaIssueCount(candidateSnapshot)
          const comparisonCount = bestTopologyCandidate
            ? this.getRepairIssueCount(bestTopologyCandidate.snapshot)
            : bestIssueCount
          const comparisonScore = bestTopologyCandidate
            ? this.getRepairIssueScore(bestTopologyCandidate.snapshot)
            : bestIssueScore
          const comparisonViaIssueCount =
            bestTopologyCandidate?.viaIssueCount ?? bestViaIssueCount
          const isBetterTopologyCandidate = this
            .initialLowCountErrorsHaveMovableTraces
            ? isBetterDrcSnapshot(
                candidateSnapshot,
                candidateViaIssueCount,
                comparisonCount,
                comparisonScore,
                comparisonViaIssueCount,
                bestTopologyCandidate?.snapshot ?? bestSnapshot,
              )
            : candidateViaIssueCount <= comparisonViaIssueCount &&
              isDrcSnapshotCountBetter(
                candidateSnapshot,
                bestTopologyCandidate?.snapshot ?? bestSnapshot,
              )
          if (isBetterTopologyCandidate) {
            bestTopologyCandidate = {
              routes: materializedCandidateRoutes,
              snapshot: candidateSnapshot,
              viaIssueCount: candidateViaIssueCount,
              usesViaInPad: false,
            }
          }
        }
        this.tracePairDetourCursorByErrorId.set(traceErrorKey, detourCursor)
      }
      for (const endpointSide of this.enableViaInPadLayerMoves
        ? (["start", "end"] as const)
        : []) {
        if (candidateAttemptsThisStep >= maxCandidateAttemptsThisStep) break
        if (traceRouteIndex === undefined) break
        const candidateRoutes = cloneRoutesForIndexes(bestRoutes, [
          traceRouteIndex,
        ])
        const changed = applyTerminalViaRelocationForError(
          this.srj,
          candidateRoutes,
          error,
          bestSnapshot.traceRouteIndexById,
          endpointSide,
          this.connMap,
          this.viaHoleDiameter,
        )
        if (!changed) continue

        const materializedCandidateRoutes = materializeRoutesForIndexes(
          candidateRoutes,
          [traceRouteIndex],
        )
        this.viaInPadCandidateAttempts += 1
        candidateAttemptsThisStep += 1
        this.candidateAttempts += 1
        const candidateSnapshot = this.getSnapshot(materializedCandidateRoutes)
        const candidateViaIssueCount = this.getViaIssueCount(candidateSnapshot)
        const comparisonCount = bestTopologyCandidate
          ? this.getRepairIssueCount(bestTopologyCandidate.snapshot)
          : bestIssueCount
        const comparisonScore = bestTopologyCandidate
          ? this.getRepairIssueScore(bestTopologyCandidate.snapshot)
          : bestIssueScore
        const comparisonViaIssueCount =
          bestTopologyCandidate?.viaIssueCount ?? bestViaIssueCount

        if (
          isBetterDrcSnapshot(
            candidateSnapshot,
            candidateViaIssueCount,
            comparisonCount,
            comparisonScore,
            comparisonViaIssueCount,
            bestTopologyCandidate?.snapshot ?? bestSnapshot,
          )
        ) {
          bestTopologyCandidate = {
            routes: materializedCandidateRoutes,
            snapshot: candidateSnapshot,
            viaIssueCount: candidateViaIssueCount,
            usesViaInPad: true,
          }
        }
      }
      const viaInPadLayerCount = this.enableViaInPadLayerMoves
        ? this.srj.layerCount
        : 0
      for (let targetZ = 0; targetZ < viaInPadLayerCount; targetZ += 1) {
        if (candidateAttemptsThisStep >= maxCandidateAttemptsThisStep) break
        if (traceRouteIndex === undefined) break
        const candidateRoutes = cloneRoutesForIndexes(bestRoutes, [
          traceRouteIndex,
        ])
        const changed = applyViaInPadLayerMoveForError(
          this.srj,
          candidateRoutes,
          error,
          bestSnapshot.traceRouteIndexById,
          targetZ,
          this.connMap,
          this.viaHoleDiameter,
        )
        if (!changed) continue

        const materializedCandidateRoutes = materializeRoutesForIndexes(
          candidateRoutes,
          [traceRouteIndex],
        )
        this.viaInPadCandidateAttempts += 1
        candidateAttemptsThisStep += 1
        this.candidateAttempts += 1
        const candidateSnapshot = this.getSnapshot(materializedCandidateRoutes)
        const candidateViaIssueCount = this.getViaIssueCount(candidateSnapshot)
        const comparisonCount = bestTopologyCandidate
          ? this.getRepairIssueCount(bestTopologyCandidate.snapshot)
          : bestIssueCount
        const comparisonScore = bestTopologyCandidate
          ? this.getRepairIssueScore(bestTopologyCandidate.snapshot)
          : bestIssueScore
        const comparisonViaIssueCount =
          bestTopologyCandidate?.viaIssueCount ?? bestViaIssueCount

        if (
          isBetterDrcSnapshot(
            candidateSnapshot,
            candidateViaIssueCount,
            comparisonCount,
            comparisonScore,
            comparisonViaIssueCount,
            bestTopologyCandidate?.snapshot ?? bestSnapshot,
          )
        ) {
          bestTopologyCandidate = {
            routes: materializedCandidateRoutes,
            snapshot: candidateSnapshot,
            viaIssueCount: candidateViaIssueCount,
            usesViaInPad: true,
          }
        }
      }
      if (
        this.enableViaInPadLayerMoves &&
        shouldTryTracePairTopology &&
        traceRoutePair
      ) {
        const routeSides =
          this.iterations % 2 === 0 ? ([0, 1] as const) : ([1, 0] as const)
        const spanExpansion = this.iterations % 3
        for (const routeSide of routeSides) {
          for (let targetZ = 0; targetZ < this.srj.layerCount; targetZ += 1) {
            if (candidateAttemptsThisStep >= maxCandidateAttemptsThisStep) break
            const changedRouteIndex = traceRoutePair[routeSide]
            const candidateRoutes = cloneRoutesForIndexes(bestRoutes, [
              changedRouteIndex,
            ])
            const changed = applyTracePairLayerMoveForError(
              this.srj,
              candidateRoutes,
              error,
              bestSnapshot.traceRouteIndexById,
              routeSide,
              targetZ,
              spanExpansion,
              this.connMap,
              this.viaHoleDiameter,
            )
            if (!changed) continue

            const materializedCandidateRoutes = materializeRoutesForIndexes(
              candidateRoutes,
              [changedRouteIndex],
            )
            this.viaInPadCandidateAttempts += 1
            candidateAttemptsThisStep += 1
            this.candidateAttempts += 1
            const candidateSnapshot = this.getSnapshot(
              materializedCandidateRoutes,
            )
            const candidateViaIssueCount =
              this.getViaIssueCount(candidateSnapshot)
            const comparisonCount = bestTopologyCandidate
              ? this.getRepairIssueCount(bestTopologyCandidate.snapshot)
              : bestIssueCount
            const comparisonScore = bestTopologyCandidate
              ? this.getRepairIssueScore(bestTopologyCandidate.snapshot)
              : bestIssueScore
            const comparisonViaIssueCount =
              bestTopologyCandidate?.viaIssueCount ?? bestViaIssueCount

            if (
              isBetterDrcSnapshot(
                candidateSnapshot,
                candidateViaIssueCount,
                comparisonCount,
                comparisonScore,
                comparisonViaIssueCount,
                bestTopologyCandidate?.snapshot ?? bestSnapshot,
              )
            ) {
              bestTopologyCandidate = {
                routes: materializedCandidateRoutes,
                snapshot: candidateSnapshot,
                viaIssueCount: candidateViaIssueCount,
                usesViaInPad: true,
              }
            }
          }
        }
      }

      if (bestTopologyCandidate) {
        bestRoutes = bestTopologyCandidate.routes
        bestSnapshot = bestTopologyCandidate.snapshot
        bestIssueCount = this.getRepairIssueCount(bestSnapshot)
        bestIssueScore = this.getRepairIssueScore(bestSnapshot)
        bestViaIssueCount = bestTopologyCandidate.viaIssueCount
        this.targetedForceAccepted = true
        if (bestTopologyCandidate.usesViaInPad) {
          this.viaInPadCandidatesAccepted += 1
        }
        acceptedCandidate = true
      }
    }

    if (!acceptedCandidate && targetedSweepErrors.length >= 2) {
      const candidateRoutes = cloneRoutes(bestRoutes)
      let changed = false
      for (const error of targetedSweepErrors) {
        changed =
          applyDrcErrorForces(
            this.srj,
            candidateRoutes,
            [error],
            bestSnapshot.traceRouteIndexById,
            1,
            this.connMap,
            true,
            this.enableTargetedErrorSweep,
            false,
            this.enableTraceViaOwnerTargeting,
          ) || changed
      }

      if (changed) {
        const materializedCandidateRoutes = materializeRoutes(candidateRoutes)
        candidateAttemptsThisStep += 1
        this.candidateAttempts += 1
        const candidateSnapshot = this.getSnapshot(materializedCandidateRoutes)
        const candidateViaIssueCount = this.getViaIssueCount(candidateSnapshot)

        if (
          isBetterDrcSnapshot(
            candidateSnapshot,
            candidateViaIssueCount,
            bestIssueCount,
            bestIssueScore,
            bestViaIssueCount,
            bestSnapshot,
          )
        ) {
          bestRoutes = materializedCandidateRoutes
          bestSnapshot = candidateSnapshot
          bestIssueCount = this.getRepairIssueCount(candidateSnapshot)
          bestIssueScore = this.getRepairIssueScore(candidateSnapshot)
          bestViaIssueCount = candidateViaIssueCount
          this.targetedForceAccepted = true
          acceptedCandidate = true
          if (candidateSnapshot.count === 0) {
            this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
            return
          }
        }
      }
    }

    for (
      let errorOffset = 0;
      errorOffset < maxErrorsThisStep &&
      candidateAttemptsThisStep < maxCandidateAttemptsThisStep &&
      !acceptedCandidate;
      errorOffset += 1
    ) {
      const errorIndex =
        (startErrorIndex + errorOffset) % prioritizedErrors.length
      const error = prioritizedErrors[errorIndex]
      if (!error) continue

      this.errorCursor = (errorIndex + 1) % prioritizedErrors.length
      const canMoveSharedViaSiteWithoutTradingDrcErrors = bestIssueCount === 1

      const forceTrials: Array<Extract<ParallelGlobalDrcTrial, { kind: "force-scale" }>> =
        getForceScalesForEffort(this.effort).map((scale) => ({
          kind: "force-scale", trialIndex: this.nextTrialIndex++,
          srj: this.srj, hdRoutes: bestRoutes, error,
          connectivity: this.getTrialConnectivity(),
          traceRouteIndexById: bestSnapshot.traceRouteIndexById,
          scale, enableTargetedErrorSweep: this.enableTargetedErrorSweep,
          canMoveSharedViaSiteWithoutTradingDrcErrors,
          enableTraceViaOwnerTargeting: this.enableTraceViaOwnerTargeting,
        }))
      const forceResults = this.correlateTrialResults(forceTrials, yield forceTrials)
      for (const trial of forceTrials) {
        if (candidateAttemptsThisStep >= maxCandidateAttemptsThisStep) break
        const placement = forceResults.get(trial.trialIndex)!.placements[0]!
        if (placement.status === "unchanged") continue
        if (placement.status === "exception" && !placement.countedBeforeException) {
          throw reconstructTrialException(placement.exception)
        }
        const materializedCandidateRoutes = placement.routes
        candidateAttemptsThisStep += 1
        this.candidateAttempts += 1
        const candidateSnapshot = this.getPreparedTrialSnapshot(placement)
        const candidateViaIssueCount = this.getViaIssueCount(candidateSnapshot)

        if (
          isBetterDrcSnapshot(
            candidateSnapshot,
            candidateViaIssueCount,
            bestIssueCount,
            bestIssueScore,
            bestViaIssueCount,
            bestSnapshot,
          )
        ) {
          bestRoutes = materializedCandidateRoutes
          bestSnapshot = candidateSnapshot
          bestIssueCount = this.getRepairIssueCount(candidateSnapshot)
          bestIssueScore = this.getRepairIssueScore(candidateSnapshot)
          bestViaIssueCount = candidateViaIssueCount
          this.targetedForceAccepted = true
          acceptedCandidate = true
          if (candidateSnapshot.count === 0) {
            this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
            return
          }
          break
        }
      }

      if (acceptedCandidate) break
    }

    const canAffordBroadFallback =
      bestRoutes.length <= BROAD_FALLBACK_SMALL_ROUTE_LIMIT
    const largeBoardBroadFallbackCadence = getLargeBoardBroadFallbackCadence(
      centeredErrors.length,
    )
    const shouldTryPeriodicLargeBoardBroadFallback =
      this.enableLargeBoardBroadFallback &&
      this.MAX_ITERATIONS >= MIN_ITERATIONS_FOR_LARGE_BOARD_BROAD_FALLBACK &&
      !canAffordBroadFallback &&
      this.stalledIterations > 0 &&
      this.stalledIterations % largeBoardBroadFallbackCadence === 0
    if (
      this.enableBroadFallback &&
      !acceptedCandidate &&
      (canAffordBroadFallback ||
        (this.effort >= 2 && this.stalledIterations >= 2) ||
        shouldTryPeriodicLargeBoardBroadFallback)
    ) {
      attemptedPeriodicLargeBoardBroadFallback =
        shouldTryPeriodicLargeBoardBroadFallback
      for (const passMultiplier of [1, EXTENDED_BROAD_FORCE_PASS_MULTIPLIER]) {
        const broadCandidateRoutes = applyBroadRepulsionForces(
          this.srj,
          bestRoutes,
          this.effort,
          passMultiplier,
          this.connMap,
          this.drcEvaluator === undefined,
          // This is a speculative candidate and is DRC-evaluated immediately.
          // Final cleanup here can perturb branch selection and trigger another
          // expensive broad attempt; direct/final broad outputs still clean up.
          false,
        )
        if (broadCandidateRoutes === bestRoutes) continue
        const broadCandidateSnapshot = this.getSnapshot(broadCandidateRoutes)
        const broadCandidateViaIssueCount = this.getViaIssueCount(
          broadCandidateSnapshot,
        )
        if (
          !isBetterDrcSnapshot(
            broadCandidateSnapshot,
            broadCandidateViaIssueCount,
            bestIssueCount,
            bestIssueScore,
            bestViaIssueCount,
            bestSnapshot,
          )
        ) {
          continue
        }

        bestRoutes = broadCandidateRoutes
        bestSnapshot = broadCandidateSnapshot
        bestIssueCount = this.getRepairIssueCount(broadCandidateSnapshot)
        bestIssueScore = this.getRepairIssueScore(broadCandidateSnapshot)
        bestViaIssueCount = broadCandidateViaIssueCount
        this.broadForceAccepted = true
        acceptedCandidate = true
        if (broadCandidateSnapshot.count === 0) {
          this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
          return
        }
      }
    }

    if (acceptedCandidate) {
      this.largeBoardBroadFallbackMisses = 0
    } else if (attemptedPeriodicLargeBoardBroadFallback) {
      this.largeBoardBroadFallbackMisses += 1
    }

    this.outputHdRoutes = bestRoutes
    this.outputSnapshot = bestSnapshot
    this.stalledIterations = acceptedCandidate ? 0 : this.stalledIterations + 1
    if (!tracePairDetourAttemptedThisStep) {
      this.updateDrcCountPlateauState(bestSnapshot)
    }
    this.updateStats(bestSnapshot)
    if (this.solved || bestIssueCount === 0) {
      this.acceptSolvedRoutes(bestRoutes, bestSnapshot)
    }
  }

  override tryFinalAcceptance() {
    const snapshot =
      this.outputSnapshot ?? this.getSnapshot(this.outputHdRoutes)
    if (
      this.legacyCleanCheckpoint &&
      getNonViaPadDrcIssueCount(snapshot) > 0 &&
      this.finishAtLegacyCleanCheckpoint()
    ) {
      return
    }
    this.acceptSolvedRoutes(this.outputHdRoutes, snapshot)
  }

  override getOutput() {
    return this.outputHdRoutes
  }

  override visualize(): GraphicsObject {
    return registeredVisualizer?.(this) ?? super.visualize()
  }

  override preview(): GraphicsObject {
    return this.visualize()
  }
}
