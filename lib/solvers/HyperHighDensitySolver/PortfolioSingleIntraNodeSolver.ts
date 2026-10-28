import {
  HighDensitySolverA03 as HighDensityA03Solver,
  HighDensitySolverA01,
} from "@tscircuit/high-density-a01"
import { HighDensitySolverA13 } from "@tscircuit/high-density-a13"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { CachedIntraNodeRouteSolver } from "../HighDensitySolver/CachedIntraNodeRouteSolver"
import type { BaseSolver } from "../BaseSolver"
import { decomposePriorityTasks } from "../HighDensitySolver/decomposePriorityTasks"
import { PriorityDagIntraNodeSolver } from "../HighDensitySolver/PriorityDagIntraNodeSolver"
import { IntraNodeRouteSolver } from "../HighDensitySolver/IntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver2 } from "../HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import { MultiHeadPolyLineIntraNodeSolver3 } from "../HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { SingleLayerNoDifferentRootIntersectionsIntraNodeSolver } from "../HighDensitySolver/SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
import { SingleTransitionIntraNodeSolver } from "../HighDensitySolver/SingleTransitionIntraNodeSolver"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "../HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import {
  precomputeIntraNodeRouteParams,
  type PrecomputedIntraNodeRouteParams,
} from "../HighDensitySolver/precomputeIntraNodeRouteParams"
import { SingleTransitionCrossingRouteSolver } from "../HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import { TwoCrossingRoutesHighDensitySolver } from "../HighDensitySolver/TwoRouteHighDensitySolver/TwoCrossingRoutesHighDensitySolver"
import {
  HyperParameterSupervisorSolver,
  SupervisedSolver,
  type HyperParameterDef,
} from "../HyperParameterSupervisorSolver"
import { HighDensitySolverA13WithDrcValidation } from "./HighDensitySolverA13WithDrcValidation"
import { repairDisconnectedSameRootPortPoints } from "./repairDisconnectedSameRootPortPoints"
import { EndpointPreservingHighDensitySolverA01 } from "./EndpointPreservingHighDensitySolverA01"
import { DeferredHighDensityGridSetup } from "./DeferredHighDensityGridSetup"

// Match the existing six-ordering portfolio used by the other intra-node
// solver. The first ordering remains in the normal portfolio; the remaining
// orderings are introduced only after that portfolio spends its dynamically
// derived exploration budget or exhausts all of its candidates.
const ORDERING_SHUFFLE_SEEDS = Array.from({ length: 6 }, (_, seed) => seed)

export type PortfolioMode = "legacy" | "eager" | "lazy" | "research-race"

type SelectiveCpuUsage = { user: number; system: number }
export type SelectivePortfolioTiming = "threadCpu" | "cpu" | "elapsed"
type ThreadCpuProcess = { threadCpuUsage?: () => SelectiveCpuUsage }

type SelectiveCandidateFamily = "fast" | "native" | "a01" | "a03" | "a13" | "polyline"
type SelectiveCandidate = {
  hyperParameters: Record<string, any>
  family: SelectiveCandidateFamily
  supervised?: SupervisedSolver<IntraNodeRouteSolver>
  elapsedMs: number
  searchMs: number
  bestProgress: number
  lastImprovementAtMs: number
  quanta: number
  calibrationIterations: number
  calibrationMs: number
}

type PortfolioCandidateSolver =
  | IntraNodeRouteSolver
  | TwoCrossingRoutesHighDensitySolver
  | SingleTransitionCrossingRouteSolver
  | SingleTransitionIntraNodeSolver
  | SingleTransitionThroughObstacleIntraNodeSolver
  | SingleLayerNoDifferentRootIntersectionsIntraNodeSolver
  | HighDensityA03Solver
  | HighDensitySolverA13

/** Coordinates deterministic fitness scheduling, with an explicit research race. */
export class PortfolioSingleIntraNodeSolver extends HyperParameterSupervisorSolver<PortfolioCandidateSolver> {
  override getSolverName(): string {
    return "PortfolioSingleIntraNodeSolver"
  }

  constructorParams: ConstructorParameters<
    typeof CachedIntraNodeRouteSolver
  >[0] & {
    boardGeometry?: HighDensityBoardGeometry
  }
  solvedRoutes: HighDensityIntraNodeRoute[] = []
  nodeWithPortPoints: NodeWithPortPoints
  connMap?: ConnectivityMap
  effort: number
  adaptiveSearchExpanded = false
  negotiatedSearchStarted = false
  readonly enableNegotiatedSearch: boolean
  readonly gridSearchSegmentWork: number
  readonly gridSearchWorkScale: number
  readonly rejectOverlappingTerminals: boolean
  readonly portfolioMode: PortfolioMode
  /** Historical alias: true selects the timing-based research race. */
  readonly selectivePortfolio: boolean
  private readonly lazyGridSetups = new WeakMap<object, DeferredHighDensityGridSetup>()
  private lazyDeferredCount = 0
  private lazyMaterializedCount = 0
  private eagerGridSetupCount = 0
  private deterministicStatsRecorded = false
  readonly selectiveClockSource: SelectivePortfolioTiming
  private readonly selectiveThreadCpuUsage?: () => SelectiveCpuUsage
  private selectiveCandidates: SelectiveCandidate[] = []
  private nextSelectiveCandidate = 0
  private selectiveElapsedMs = 0
  private selectiveSinceAdmissionMs = 0
  private selectiveAttemptBudgetMs = Number.POSITIVE_INFINITY
  private selectiveCalibrationRates: number[] = []
  private selectiveWallStartedAt = 0
  private selectiveCpuStartedAt = 0
  private selectiveThreadCpuStartedAt = 0
  private precomputedIntraNodeRouteParams?: PrecomputedIntraNodeRouteParams
  private nodeSegmentCount?: number
  private totalCandidateWork = 0
  private dynamicExpansionWorkBudget = 1
  private candidateWorkBySolver = new WeakMap<
    BaseSolver,
    { iterations: number; maxIterations: number }
  >()

  private getSolvedSegmentCount(solver: unknown): number | null {
    const solvedConnectionsMap = (solver as any).solvedConnectionsMap
    if (!(solvedConnectionsMap instanceof Map)) return null

    let solvedSegmentCount = 0
    for (const routes of solvedConnectionsMap.values()) {
      if (Array.isArray(routes)) solvedSegmentCount += routes.length
    }
    return solvedSegmentCount
  }

  private getNodeSegmentCount(): number {
    this.nodeSegmentCount ??= Math.max(
      1,
      this.nodeWithPortPoints.portPointsInPairs?.length ??
        new Set(
          this.nodeWithPortPoints.portPoints.map(
            (portPoint) => portPoint.connectionName,
          ),
        ).size,
    )
    return this.nodeSegmentCount
  }

  private getCandidateProgress(solver: { progress: number }): number {
    // A03's solved-map getter requires setup. A known deferred candidate has
    // the same zero progress as the eagerly allocated, unadvanced candidate.
    if (this.lazyGridSetups.get(solver)?.pending) return 0
    if (solver instanceof HighDensitySolverA13) {
      if (solver.solved) return 1
      const connectionCount = solver.connections.length
      if (connectionCount === 0) return 0
      // A complete set of provisional paths still needs congestion negotiation.
      const routedFraction = solver.routedCount / connectionCount
      const conflictFreeFraction = Math.max(
        0,
        (solver.routedCount - solver.conflictCount) / connectionCount,
      )
      return Math.min(0.99, (routedFraction + conflictFreeFraction) / 2)
    }
    const solvedSegmentCount = this.getSolvedSegmentCount(solver)
    if (solvedSegmentCount !== null) {
      return Math.min(1, solvedSegmentCount / this.getNodeSegmentCount())
    }
    return Math.max(0, Math.min(1, solver.progress || 0))
  }

  constructor(
    opts: ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0] & {
      effort?: number
      enableNegotiatedSearch?: boolean
      gridSearchSegmentWork?: number
      gridSearchWorkScale?: number
      rejectOverlappingTerminals?: boolean
      selectivePortfolio?: boolean
      portfolioMode?: PortfolioMode
      selectivePortfolioTiming?: SelectivePortfolioTiming
      boardGeometry?: HighDensityBoardGeometry
    },
  ) {
    super()
    this.nodeWithPortPoints = opts.nodeWithPortPoints
    this.connMap = opts.connMap
    this.constructorParams = opts
    this.effort = opts.effort ?? 1
    this.gridSearchSegmentWork = opts.gridSearchSegmentWork ?? 10_000
    this.gridSearchWorkScale = opts.gridSearchWorkScale ?? 1
    this.rejectOverlappingTerminals = opts.rejectOverlappingTerminals ?? false
    this.enableNegotiatedSearch = opts.enableNegotiatedSearch ?? false
    this.portfolioMode = opts.portfolioMode ?? (opts.selectivePortfolio ? "research-race" : "legacy")
    if (!["legacy", "eager", "lazy", "research-race"].includes(this.portfolioMode)) {
      throw new Error(`Unsupported portfolio mode: ${this.portfolioMode}`)
    }
    if (opts.selectivePortfolio && this.portfolioMode !== "research-race") {
      throw new Error("selectivePortfolio=true conflicts with the explicit deterministic portfolio mode")
    }
    this.selectivePortfolio = this.portfolioMode === "research-race"
    const hasCpuClock = typeof process !== "undefined" && typeof process.cpuUsage === "function"
    const threadCpuUsage = typeof process === "undefined"
      ? undefined : (process as unknown as ThreadCpuProcess).threadCpuUsage
    if (typeof threadCpuUsage === "function") {
      this.selectiveThreadCpuUsage = threadCpuUsage.bind(process)
    }
    this.selectiveClockSource = opts.selectivePortfolioTiming ?? (
      this.selectiveThreadCpuUsage ? "threadCpu" : hasCpuClock ? "cpu" : "elapsed"
    )
    if (this.selectivePortfolio && this.selectiveClockSource === "cpu" && !hasCpuClock) {
      throw new Error("Selective portfolio CPU timing requires process.cpuUsage()")
    }
    if (this.selectivePortfolio && this.selectiveClockSource === "threadCpu" && !this.selectiveThreadCpuUsage) {
      throw new Error("Selective portfolio thread CPU timing requires process.threadCpuUsage()")
    }
    this.MAX_ITERATIONS = 20_000_000 * this.effort
    this.GREEDY_MULTIPLIER = 5
    this.MIN_SUBSTEPS = 100
    // These endpoints are fixed within this attempt. No route ordering can
    // separate overlapping copper; let the existing grow/shrink search move
    // to a feasible scale instead of exhausting every candidate here.
    if (this.rejectOverlappingTerminals) {
      const ports = this.nodeWithPortPoints.portPoints
      const traceWidth = opts.traceWidth ?? 0.15
      for (let i = 0; i < ports.length; i++) {
        for (let j = i + 1; j < ports.length; j++) {
          const a = ports[i]!
          const b = ports[j]!
          if (
            a.z !== b.z ||
            (a.rootConnectionName ?? a.connectionName) ===
              (b.rootConnectionName ?? b.connectionName) ||
            this.connMap?.areIdsConnected(a.connectionName, b.connectionName)
          ) {
            continue
          }
          if (Math.hypot(a.x - b.x, a.y - b.y) < traceWidth - 1e-6) {
            this.failed = true
            this.error =
              "Unrelated route terminals overlap at the requested trace width"
            return
          }
        }
      }
    }
  }

  private getGridSearchIterationBudget(): number {
    const node = this.nodeWithPortPoints
    const layerCount =
      node.availableZ?.length ??
      new Set(node.portPoints.map((point) => point.z)).size
    const states =
      Math.floor(node.width / 0.1) * Math.floor(node.height / 0.1) * layerCount
    // Avoid the external solvers' two-million-iteration floor on small grids,
    // while retaining room for interacting connections on crowded nodes.
    const budgetScale = layerCount > 2 ? this.gridSearchWorkScale : 1
    return Math.round(
      budgetScale *
        Math.max(
          150_000,
          (layerCount <= 2 ? 10_000 : this.gridSearchSegmentWork) *
            this.getNodeSegmentCount() ** 2,
          Math.round(
            states *
              (8 + 1.2 * Math.sqrt(this.getNodeSegmentCount())) *
              this.effort,
          ),
        ),
    )
  }

  getCombinationDefs() {
    return [
      ["throughObstacle"],
      ["singleLayerNoDifferentRootIntersections"],
      ["multiHeadPolyLine"],
      ["majorCombinations", "orderings6", "cellSizeFactor"],
      ["noVias"],
      ["orderings50"],
      ["flipTraceAlignmentDirection", "orderings6"],
      ["closedFormSingleTrace"],
      // ["closedFormTwoTrace"],
      ["highDensityA01"],
      ...(this.portfolioMode === "legacy" || (this.constructorParams.traceWidth ?? 0.15) === 0.1
        ? [["highDensityA03"]] : []),
      ...(this.enableNegotiatedSearch ? [["highDensityA13"]] : []),
    ]
  }

  getHyperParameterDefs(): HyperParameterDef[] {
    let priorityEligible = false
    if (this.constructorParams.priorityDagSearch) {
      this.precomputedIntraNodeRouteParams ??= precomputeIntraNodeRouteParams(
        this.nodeWithPortPoints,
      )
      const groups = [
        ...this.precomputedIntraNodeRouteParams.connectionPointsByName.entries(),
      ].map(([connectionName, points]) => ({
        connectionName,
        rootConnectionName:
          this.precomputedIntraNodeRouteParams!.rootConnectionNameByConnectionName.get(
            connectionName,
          ),
        points,
      }))
      let preflightWork = 0
      const detailed = PriorityDagIntraNodeSolver.detailedWorkDiagnostics
      priorityEligible =
        decomposePriorityTasks(groups, (_name, count = 1) => {
          if (detailed) preflightWork += count
        }) !== null
      const diagnostics = this.constructorParams.priorityDiagnostics
      if (detailed && diagnostics) {
        diagnostics.priorityEligibilityCalls =
          (diagnostics.priorityEligibilityCalls ?? 0) + 1
        diagnostics.priorityEligibilityObservedWork =
          (diagnostics.priorityEligibilityObservedWork ?? 0) + preflightWork
        if (!priorityEligible)
          diagnostics.priorityIneligiblePreflightWork =
            (diagnostics.priorityIneligiblePreflightWork ?? 0) + preflightWork
      }
    }
    return [
      {
        name: "singleLayerNoDifferentRootIntersections",
        possibleValues: [
          {
            SINGLE_LAYER_NO_DIFFERENT_ROOT_INTERSECTIONS: true,
          },
        ],
      },
      {
        name: "majorCombinations",
        possibleValues: [
          {
            FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 2,
            FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 1,
            FUTURE_CONNECTION_PROXIMITY_VD: 10,
            MISALIGNED_DIST_PENALTY_FACTOR: 5,
          },
          {
            FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 1,
            FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 0.5,
            FUTURE_CONNECTION_PROXIMITY_VD: 5,
            MISALIGNED_DIST_PENALTY_FACTOR: 2,
          },
          {
            FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 10,
            FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 1,
            FUTURE_CONNECTION_PROXIMITY_VD: 5,
            MISALIGNED_DIST_PENALTY_FACTOR: 10,
            VIA_PENALTY_FACTOR_2: 1,
          },
        ],
      },
      {
        name: "orderings6",
        possibleValues: priorityEligible
          ? [{ SHUFFLE_SEED: 0, PRIORITY_DAG_FAMILY_SIZE: 6 }]
          : ORDERING_SHUFFLE_SEEDS.map((shuffleSeed) => ({
              SHUFFLE_SEED: shuffleSeed,
            })),
      },
      {
        name: "cellSizeFactor",
        possibleValues: [
          {
            CELL_SIZE_FACTOR: 0.5,
          },
          {
            CELL_SIZE_FACTOR: 1,
          },
        ],
      },
      {
        name: "flipTraceAlignmentDirection",
        possibleValues: [
          {
            FLIP_TRACE_ALIGNMENT_DIRECTION: true,
          },
        ],
      },
      {
        name: "noVias",
        possibleValues: [
          {
            CELL_SIZE_FACTOR: 2,
            VIA_PENALTY_FACTOR_2: 10,
          },
        ],
      },
      {
        name: "orderings50",
        possibleValues: priorityEligible
          ? [{ SHUFFLE_SEED: 0, PRIORITY_DAG_FAMILY_SIZE: 20 }]
          : Array.from({ length: 20 }, (_, i) => ({
              SHUFFLE_SEED: 100 + i,
            })),
      },
      // {
      //   name: "closedFormTwoTrace",
      //   possibleValues: [
      //     {
      //       CLOSED_FORM_TWO_TRACE_SAME_LAYER: true,
      //     },
      //     {
      //       CLOSED_FORM_TWO_TRACE_TRANSITION_CROSSING: true,
      //     },
      //   ],
      // },
      {
        name: "throughObstacle",
        possibleValues: [
          {
            THROUGH_OBSTACLE: true,
          },
        ],
      },
      {
        name: "closedFormSingleTrace",
        possibleValues: [
          {
            CLOSED_FORM_SINGLE_TRANSITION: true,
          },
        ],
      },
      {
        name: "multiHeadPolyLine",
        possibleValues: [
          {
            MULTI_HEAD_POLYLINE_SOLVER: true,
            SEGMENTS_PER_POLYLINE: 6,
            BOUNDARY_PADDING: 0.05,
          },
          {
            MULTI_HEAD_POLYLINE_SOLVER: true,
            SEGMENTS_PER_POLYLINE: 6,
            BOUNDARY_PADDING: -0.05, // Allow vias/traces outside the boundary
            ITERATION_PENALTY: 10000,
            MINIMUM_FINAL_ACCEPTANCE_GAP: 0.001,
          },
        ],
      },
      {
        name: "highDensityA01",
        possibleValues: [
          {
            HIGH_DENSITY_A01: true,
            SHUFFLE_SEED: ORDERING_SHUFFLE_SEEDS[0],
          },
        ],
      },
      {
        name: "highDensityA03",
        possibleValues: [
          {
            HIGH_DENSITY_A03: true,
          },
        ],
      },
      {
        name: "highDensityA13",
        possibleValues: [{ HIGH_DENSITY_A13: true, SHUFFLE_SEED: 0 }],
      },
    ]
  }

  /**
   * Some external solvers expose an idempotent setup phase that calculates
   * their natural iteration budget from the problem. Running setup here does
   * not advance the solver or give it preference in the portfolio.
   */
  private initializeCandidateBudget(solver: unknown) {
    // A13 already declares its search limit; allocate its grid only if selected.
    if (solver instanceof HighDensitySolverA13) return
    if (solver instanceof HighDensitySolverA01 || solver instanceof HighDensityA03Solver) {
      if (this.portfolioMode === "lazy") {
        const cap = this.getGridSearchIterationBudget()
        if (DeferredHighDensityGridSetup.isEligible(solver, cap)) {
          const deferred = new DeferredHighDensityGridSetup(solver, cap, (): void => {
            this.lazyMaterializedCount++
            this.updateLazySetupStats()
          })
          this.lazyGridSetups.set(solver, deferred)
          this.lazyDeferredCount++
          this.updateLazySetupStats()
          return
        }
      }
      this.eagerGridSetupCount++
    }
    const setup = (solver as any).setup
    if (typeof setup === "function") setup.call(solver)
    if (
      solver instanceof HighDensitySolverA01 ||
      solver instanceof HighDensityA03Solver
    ) {
      solver.MAX_ITERATIONS = Math.min(
        solver.MAX_ITERATIONS,
        this.getGridSearchIterationBudget(),
      )
    }
  }

  private refreshDynamicIterationLimit() {
    this.totalCandidateWork = 0
    this.dynamicExpansionWorkBudget = 1
    const remainingSupervisorIterations = (this.supervisedSolvers ?? []).reduce(
      (total, { solver }) => {
        // A13 negotiates route orders internally. Its larger budget must not
        // delay expansion of the existing A01 ordering search.
        if (!(solver instanceof HighDensitySolverA13)) {
          this.totalCandidateWork += solver.iterations
          // Preserve the work budget of the most expensive initial candidate.
          this.dynamicExpansionWorkBudget = Math.max(
            this.dynamicExpansionWorkBudget,
            solver instanceof PriorityDagIntraNodeSolver
              ? solver.nativeCandidateIterationLimit
              : solver.MAX_ITERATIONS,
          )
          this.candidateWorkBySolver.set(solver, {
            iterations: solver.iterations,
            maxIterations: solver.MAX_ITERATIONS,
          })
        }
        if (solver.solved || solver.failed) return total
        const remainingCandidateIterations = Math.max(
          0,
          solver.MAX_ITERATIONS - solver.iterations + 1,
        )
        return (
          total + Math.ceil(remainingCandidateIterations / this.MIN_SUBSTEPS)
        )
      },
      0,
    )

    // Keep one supervisor step available to observe that the current
    // portfolio is exhausted and expand it before BaseSolver can fail.
    this.MAX_ITERATIONS = Math.max(
      this.iterations + 1,
      this.iterations + remainingSupervisorIterations,
    )
    this.stats.dynamicSupervisorIterationLimit = this.MAX_ITERATIONS
  }

  override initializeSolvers() {
    if (this.portfolioMode === "eager" || this.portfolioMode === "lazy") {
      this.stats.portfolioMode = this.portfolioMode
    }
    if (this.selectivePortfolio) {
      this.initializeSelectivePortfolio()
      return
    }
    super.initializeSolvers()
    for (const { solver } of this.supervisedSolvers ?? []) {
      this.initializeCandidateBudget(solver)
    }
    this.refreshDynamicIterationLimit()
    this.stats.dynamicExpansionWorkBudget = this.dynamicExpansionWorkBudget
    this.updateLazySetupStats()
  }

  override getSupervisedSolverWithBestFitness(): SupervisedSolver<PortfolioCandidateSolver> | null {
    const candidate = super.getSupervisedSolverWithBestFitness()
    // Selection is the unchanged legacy comparison. Materializing only its
    // winner also keeps explicit inspection/visualization of that winner safe.
    const deferred = candidate ? this.lazyGridSetups.get(candidate.solver) : undefined
    if (deferred?.pending) deferred.materialize()
    return candidate
  }

  private updateLazySetupStats(): void {
    if (this.portfolioMode !== "lazy") return
    this.stats.lazyGridSetupDeferredCount = this.lazyDeferredCount
    this.stats.lazyGridSetupMaterializedCount = this.lazyMaterializedCount
    this.stats.lazyGridSetupUnmaterializedCount = this.lazyDeferredCount - this.lazyMaterializedCount
    this.stats.lazyGridSetupEagerCount = this.eagerGridSetupCount
  }

  private recordDeterministicStats(): void {
    if (this.deterministicStatsRecorded || this.portfolioMode === "legacy" || this.selectivePortfolio) return
    this.deterministicStatsRecorded = true
    this.updateLazySetupStats()
    const diagnostics = this.constructorParams.priorityDiagnostics
    if (!diagnostics) return
    const prefix = this.portfolioMode === "lazy" ? "portfolioLazy" : "portfolioEager"
    for (const [suffix, value] of Object.entries({
      Attempts: 1,
      DeferredGridSetups: this.lazyDeferredCount,
      MaterializedGridSetups: this.lazyMaterializedCount,
      UnmaterializedGridSetups: this.lazyDeferredCount - this.lazyMaterializedCount,
      EagerGridSetups: this.eagerGridSetupCount,
      SolvedAttempts: Number(this.solved),
      UnknownAttempts: Number(!this.solved),
      A03ExcludedAttempts: Number((this.constructorParams.traceWidth ?? 0.15) !== 0.1),
    })) {
      diagnostics[prefix + suffix] = (diagnostics[prefix + suffix] ?? 0) + value
    }
  }

  private addSupervisedCandidate(hyperParameters: Record<string, any>) {
    const solver = this.generateSolver(hyperParameters)
    this.initializeCandidateBudget(solver)
    const g = this.computeG(solver)
    this.supervisedSolvers!.push({
      hyperParameters,
      solver,
      h: 0,
      g,
      f: g,
    })
  }

  private expandAdaptiveSearch() {
    if (this.adaptiveSearchExpanded) return

    this.adaptiveSearchExpanded = true
    for (const shuffleSeed of ORDERING_SHUFFLE_SEEDS.slice(1)) {
      this.addSupervisedCandidate({
        HIGH_DENSITY_A01: true,
        SHUFFLE_SEED: shuffleSeed,
      })
    }
    this.refreshDynamicIterationLimit()
    this.stats.adaptiveSearchExpanded = true
    this.stats.adaptiveSearchExpandedAtIteration = this.iterations
    this.stats.candidateWorkAtExpansion = this.totalCandidateWork
    this.stats.bestProgressAtExpansion = Math.max(
      0,
      ...(this.supervisedSolvers ?? []).map(({ solver }) =>
        this.getCandidateProgress(solver),
      ),
    )
  }

  private shouldExpandPortfolio(): boolean {
    if (this.adaptiveSearchExpanded) return false

    const expansionWorkBudget = this.dynamicExpansionWorkBudget
    this.stats.dynamicExpansionWorkBudget = expansionWorkBudget
    return this.totalCandidateWork >= expansionWorkBudget
  }

  override _step() {
    if (this.selectivePortfolio) {
      this.stepSelectivePortfolio()
      return
    }
    if (!this.supervisedSolvers) this.initializeSolvers()

    if (
      !this.adaptiveSearchExpanded &&
      !this.getSupervisedSolverWithBestFitness()
    ) {
      this.expandAdaptiveSearch()
    }

    super._step()

    if (
      !this.negotiatedSearchStarted &&
      this.activeSubSolver instanceof HighDensitySolverA13
    ) {
      this.negotiatedSearchStarted = true
      this.stats.negotiatedSearchStartedAtIteration = this.iterations
    }

    if (!this.solved && !this.failed && this.shouldExpandPortfolio()) {
      this.expandAdaptiveSearch()
    }
    if (this.solved || this.failed) this.recordDeterministicStats()
  }

  /**
   * Lazy racing keeps every admitted candidate's continuation, including its
   * rip history. Exhausting this attempt's allocation is UNKNOWN, not a proof
   * that the node (or any paused candidate) is unroutable.
   */
  private initializeSelectivePortfolio(): void {
    this.selectiveWallStartedAt = performance.now()
    if (typeof process !== "undefined" && typeof process.cpuUsage === "function") {
      const cpu = process.cpuUsage()
      this.selectiveCpuStartedAt = (cpu.user + cpu.system) / 1000
    }
    if (this.selectiveThreadCpuUsage) {
      const cpu = this.selectiveThreadCpuUsage()
      this.selectiveThreadCpuStartedAt = (cpu.user + cpu.system) / 1000
    }
    const setupStartedAt = this.getSelectiveClockNow()
    const defs = this.getHyperParameterDefs()
    const hyperParameters = this.getCombinationDefs().flatMap((names) =>
      this.getHyperParameterCombinations(defs.filter((def) => names.includes(def.name))),
    )
    hyperParameters.push(...ORDERING_SHUFFLE_SEEDS.slice(1).map((shuffleSeed) => ({
      HIGH_DENSITY_A01: true,
      SHUFFLE_SEED: shuffleSeed,
    })))
    const rank = (hp: Record<string, any>): number => {
      if (hp.THROUGH_OBSTACLE) return 0
      if (hp.SINGLE_LAYER_NO_DIFFERENT_ROOT_INTERSECTIONS) return 1
      if (hp.CLOSED_FORM_SINGLE_TRANSITION) return 2
      if (hp.HIGH_DENSITY_A01) return hp.SHUFFLE_SEED === 0 ? 4 : 8
      if (hp.HIGH_DENSITY_A03) return 5
      if (hp.HIGH_DENSITY_A13) return 6
      if (hp.MULTI_HEAD_POLYLINE_SOLVER) return 9
      // Let the first native strategy finish easy nodes before allocating a grid.
      return hp.SHUFFLE_SEED === 0 && hp.CELL_SIZE_FACTOR === 0.5 ? 3 : 7
    }
    hyperParameters.sort((a, b) => rank(a) - rank(b))
    this.selectiveCandidates = hyperParameters.map((hp) => ({
      hyperParameters: hp,
      family: hp.HIGH_DENSITY_A01 ? "a01"
        : hp.HIGH_DENSITY_A03 ? "a03"
          : hp.HIGH_DENSITY_A13 ? "a13"
            : hp.MULTI_HEAD_POLYLINE_SOLVER ? "polyline"
              : rank(hp) <= 2 ? "fast" : "native",
      elapsedMs: 0,
      searchMs: 0,
      bestProgress: 0,
      lastImprovementAtMs: 0,
      quanta: 0,
      calibrationIterations: 0,
      calibrationMs: 0,
    }))
    this.supervisedSolvers = []
    this.stats.selectivePortfolio = true
    this.stats.selectiveClockSource = this.selectiveClockSource
    this.stats.selectiveClockScope = this.selectiveClockSource === "threadCpu" ? "thread"
      : this.selectiveClockSource === "cpu" ? "process" : "elapsed"
    this.stats.selectiveThreadCpuSupported = this.selectiveThreadCpuUsage !== undefined
    this.stats.selectiveA03Eligible = (this.constructorParams.traceWidth ?? 0.15) === 0.1
    this.stats.selectiveCandidateCount = this.selectiveCandidates.length
    this.stats.selectiveCandidatesAdmitted = 0
    this.stats.selectiveAttemptStatus = "searching"
    this.selectiveElapsedMs += this.getSelectiveClockNow() - setupStartedAt
  }

  private getSelectiveClockNow(): number {
    // A worker must not charge other workers' CPU against its own candidates.
    // Process and elapsed clocks remain explicit capability/ablation modes.
    if (this.selectiveClockSource === "elapsed") return performance.now()
    const cpu = this.selectiveClockSource === "threadCpu"
      ? this.selectiveThreadCpuUsage!() : process.cpuUsage()
    return (cpu.user + cpu.system) / 1000
  }

  private admitSelectiveCandidate(): SelectiveCandidate {
    const candidate = this.selectiveCandidates[this.nextSelectiveCandidate++]!
    const start = this.getSelectiveClockNow()
    const solver = this.generateSolver(candidate.hyperParameters)
    this.initializeCandidateBudget(solver)
    candidate.supervised = {
      solver,
      hyperParameters: candidate.hyperParameters,
      g: 0,
      h: 1,
      f: 1,
    }
    const elapsedMs = this.getSelectiveClockNow() - start
    candidate.elapsedMs += elapsedMs
    this.selectiveElapsedMs += elapsedMs
    this.selectiveSinceAdmissionMs = 0
    this.supervisedSolvers!.push(candidate.supervised)
    this.stats.selectiveCandidatesAdmitted = this.nextSelectiveCandidate
    if (candidate.family === "a01" && candidate.hyperParameters.SHUFFLE_SEED !== 0) {
      this.adaptiveSearchExpanded = true
      this.stats.adaptiveSearchExpanded = true
    }
    return candidate
  }

  private chooseSelectiveCandidate(): SelectiveCandidate | undefined {
    let best: SelectiveCandidate | undefined
    let bestScore = Number.POSITIVE_INFINITY
    for (const candidate of this.selectiveCandidates) {
      const solver = candidate.supervised?.solver
      if (!solver || solver.failed) continue
      if (solver.solved) return candidate
      const stagnantMs = candidate.elapsedMs - candidate.lastImprovementAtMs
      // Progress is useful only alongside its cost and the cost since the last
      // improvement. A 99%-routed rip loop is not treated as an almost-free win.
      const stagnationPenalty = 1 + stagnantMs / Math.max(2, candidate.elapsedMs * 0.3)
      const score = (candidate.elapsedMs + 2) * stagnationPenalty /
        (0.1 + candidate.bestProgress) ** 2
      if (score < bestScore) {
        bestScore = score
        best = candidate
      }
    }
    return best
  }

  private recordSelectiveResult(status: "solved" | "unknown"): void {
    this.stats.selectiveAttemptStatus = status
    this.stats.selectiveWallElapsedMs = performance.now() - this.selectiveWallStartedAt
    if (typeof process !== "undefined" && typeof process.cpuUsage === "function") {
      const cpu = process.cpuUsage()
      this.stats.selectiveCpuMs = (cpu.user + cpu.system) / 1000 - this.selectiveCpuStartedAt
    }
    if (this.selectiveThreadCpuUsage) {
      const cpu = this.selectiveThreadCpuUsage()
      this.stats.selectiveThreadCpuMs = (cpu.user + cpu.system) / 1000 - this.selectiveThreadCpuStartedAt
    }
    this.stats.selectiveCalibrationRates = [...this.selectiveCalibrationRates]
    this.stats.selectiveElapsedMs = this.selectiveElapsedMs
    this.stats.selectiveAttemptBudgetMs = this.selectiveAttemptBudgetMs
    this.stats.selectiveCandidates = this.selectiveCandidates.flatMap((candidate) => {
      const solver = candidate.supervised?.solver
      return solver ? [{
        family: candidate.family,
        shuffleSeed: candidate.hyperParameters.SHUFFLE_SEED,
        elapsedMs: candidate.elapsedMs,
        searchMs: candidate.searchMs,
        bestProgress: candidate.bestProgress,
        iterations: solver.iterations,
        maxIterations: solver.MAX_ITERATIONS,
        solved: solver.solved,
        failed: solver.failed,
        quanta: candidate.quanta,
      }] : []
    })
    const diagnostics = this.constructorParams.priorityDiagnostics
    if (diagnostics) {
      diagnostics.portfolioSelectiveAttempts = (diagnostics.portfolioSelectiveAttempts ?? 0) + 1
      diagnostics.portfolioSelectiveAdmitted = (diagnostics.portfolioSelectiveAdmitted ?? 0) + this.nextSelectiveCandidate
      diagnostics.portfolioSelectiveUnconstructed = (diagnostics.portfolioSelectiveUnconstructed ?? 0) + this.selectiveCandidates.length - this.nextSelectiveCandidate
      diagnostics.portfolioSelectiveElapsedMicros = (diagnostics.portfolioSelectiveElapsedMicros ?? 0) + Math.round(this.selectiveElapsedMs * 1000)
      diagnostics.portfolioSelectiveUnknownAttempts = (diagnostics.portfolioSelectiveUnknownAttempts ?? 0) + Number(status === "unknown")
      diagnostics.portfolioSelectiveWallMicros = (diagnostics.portfolioSelectiveWallMicros ?? 0) + Math.round(this.stats.selectiveWallElapsedMs * 1000)
      if (this.stats.selectiveCpuMs !== undefined) {
        diagnostics.portfolioSelectiveCpuMicros = (diagnostics.portfolioSelectiveCpuMicros ?? 0) + Math.round(this.stats.selectiveCpuMs * 1000)
      }
      if (this.stats.selectiveThreadCpuMs !== undefined) {
        diagnostics.portfolioSelectiveThreadCpuMicros = (diagnostics.portfolioSelectiveThreadCpuMicros ?? 0) + Math.round(this.stats.selectiveThreadCpuMs * 1000)
      }
      const clockCounter = this.selectiveClockSource === "threadCpu" ? "portfolioSelectiveThreadCpuAttempts"
        : this.selectiveClockSource === "cpu" ? "portfolioSelectiveProcessCpuAttempts" : "portfolioSelectiveElapsedClockAttempts"
      diagnostics[clockCounter] = (diagnostics[clockCounter] ?? 0) + 1
      diagnostics.portfolioSelectiveA03ExcludedAttempts = (diagnostics.portfolioSelectiveA03ExcludedAttempts ?? 0) + Number(!this.stats.selectiveA03Eligible)
    }
  }

  private stepSelectivePortfolio(): void {
    if (!this.supervisedSolvers) this.initializeSelectivePortfolio()
    let candidate = this.chooseSelectiveCandidate()
    const pending = this.nextSelectiveCandidate < this.selectiveCandidates.length
    if (pending && (!candidate || this.selectiveSinceAdmissionMs >= 8)) {
      candidate = this.admitSelectiveCandidate()
    }
    if (!candidate) {
      this.failed = true
      this.error = "Selective portfolio exhausted all candidate allocations (UNKNOWN)"
      this.recordSelectiveResult("unknown")
      return
    }
    const supervised = candidate.supervised!
    const solver = supervised.solver
    this.activeSubSolver = solver
    if (candidate.family === "a13" && !this.negotiatedSearchStarted) {
      this.negotiatedSearchStarted = true
      this.stats.negotiatedSearchStartedAtIteration = this.iterations
    }
    const start = this.getSelectiveClockNow()
    const iterationsBefore = solver.iterations
    const quantumMs = Math.max(2, Math.min(16, candidate.elapsedMs * 0.25))
    const batchSize = candidate.family === "a01" || candidate.family === "a03" ? 128
      : candidate.family === "native" ? 8 : 1
    while (!solver.solved && !solver.failed) {
      for (let i = 0; i < batchSize && !solver.solved && !solver.failed; i++) solver.step()
      if (this.getSelectiveClockNow() - start >= quantumMs) break
    }
    const elapsedMs = this.getSelectiveClockNow() - start
    candidate.elapsedMs += elapsedMs
    candidate.searchMs += elapsedMs
    candidate.quanta++
    this.selectiveElapsedMs += elapsedMs
    this.selectiveSinceAdmissionMs += elapsedMs
    const progress = this.getCandidateProgress(solver)
    if (progress > candidate.bestProgress + 1e-9) {
      candidate.bestProgress = progress
      candidate.lastImprovementAtMs = candidate.elapsedMs
    }
    this.progress = Math.max(this.progress, Math.min(0.99, progress))
    supervised.g = candidate.elapsedMs
    supervised.h = 1 - progress
    supervised.f = candidate.elapsedMs
    // Calibrate all families in measured execution time against four
    // natural A01 allocations. Include setup and every losing probe in cost.
    // The minimum probe prevents tiny clock deltas from setting the budget.
    if (candidate.family === "a01" && !Number.isFinite(this.selectiveAttemptBudgetMs)) {
      const warmupIterations = Math.max(4096, Math.min(65_536, Math.floor(solver.MAX_ITERATIONS / 8)))
      if (iterationsBefore >= warmupIterations) {
        candidate.calibrationIterations += solver.iterations - iterationsBefore
        candidate.calibrationMs += elapsedMs
      }
      if (candidate.calibrationIterations >= 4096 && candidate.calibrationMs >= 2) {
        this.selectiveCalibrationRates.push(candidate.calibrationMs / candidate.calibrationIterations)
        candidate.calibrationIterations = 0
        candidate.calibrationMs = 0
        if (this.selectiveCalibrationRates.length === 3) {
          const rates = [...this.selectiveCalibrationRates].sort((a, b) => a - b)
          // Freeze after the median completed probe: later JIT improvements
          // must not retroactively shrink a physical attempt's allocation.
          this.selectiveAttemptBudgetMs = Math.max(50 * this.effort, rates[1]! * solver.MAX_ITERATIONS * 4)
        }
      }
    }
    this.stats.selectiveElapsedMs = this.selectiveElapsedMs
    this.stats.selectiveAttemptBudgetMs = this.selectiveAttemptBudgetMs
    if (solver.solved) {
      this.solved = true
      this.winningSolver = solver
      this.onSolve(supervised)
      this.recordSelectiveResult("solved")
      return
    }
    // Every candidate receives a bounded probe before terminating a limited
    // attempt. Paused solvers are not marked failed and can be inspected.
    const allCandidatesProbed = this.selectiveCandidates.every((entry) => entry.quanta > 0)
    if (allCandidatesProbed && this.selectiveElapsedMs >= this.selectiveAttemptBudgetMs) {
      this.failed = true
      this.error = "Selective portfolio exhausted its calibrated effort allocation (UNKNOWN)"
      this.recordSelectiveResult("unknown")
    }
  }

  override tryFinalAcceptance(): void {
    if (!this.selectivePortfolio) this.recordDeterministicStats()
    if (this.selectivePortfolio && !this.solved && this.stats.selectiveAttemptStatus !== "unknown") {
      // BaseSolver owns this hard dispatch limit and marks the failure after
      // this hook. Record its allocation as UNKNOWN without extending it.
      this.stats.selectiveUnknownReason = "supervisor iteration allocation"
      this.recordSelectiveResult("unknown")
    }
  }

  computeG(solver: IntraNodeRouteSolver): number {
    if (solver instanceof HighDensitySolverA13) {
      return solver.routingIterations / 1_000_000
    }
    // The supervisor advances one candidate before recomputing its fitness.
    // Account for that candidate's actual work without rescanning the portfolio.
    const accountedWork = this.candidateWorkBySolver.get(solver)
    if (accountedWork) {
      this.totalCandidateWork += solver.iterations - accountedWork.iterations
      accountedWork.iterations = solver.iterations
      if (accountedWork.maxIterations !== solver.MAX_ITERATIONS) {
        accountedWork.maxIterations = solver.MAX_ITERATIONS
        this.dynamicExpansionWorkBudget = 1
        for (const { solver: candidate } of this.supervisedSolvers ?? []) {
          if (candidate instanceof HighDensitySolverA13) continue
          this.dynamicExpansionWorkBudget = Math.max(
            this.dynamicExpansionWorkBudget,
            candidate instanceof PriorityDagIntraNodeSolver
              ? candidate.nativeCandidateIterationLimit
              : candidate.MAX_ITERATIONS,
          )
        }
      }
    }
    if (
      (solver as any) instanceof HighDensitySolverA01 ||
      (solver as any) instanceof HighDensityA03Solver ||
      (solver as any) instanceof HighDensitySolverA13
    ) {
      return (solver as any).iterations / 1_000_000
    }
    if (solver?.hyperParameters?.MULTI_HEAD_POLYLINE_SOLVER) {
      return (
        1000 +
        ((solver.hyperParameters?.ITERATION_PENALTY ?? 0) + solver.iterations) /
          10_000 +
        10_000 * (solver.hyperParameters.SEGMENTS_PER_POLYLINE! - 3)
      )
    }
    return (
      solver.iterations / 10_000 // + solver.hyperParameters.SHUFFLE_SEED! * 0.05
    )
  }

  computeH(solver: IntraNodeRouteSolver): number {
    if (solver instanceof HighDensitySolverA13) {
      return 1 - this.getCandidateProgress(solver)
    }
    if (this.adaptiveSearchExpanded) {
      return 1 - this.getCandidateProgress(solver)
    }
    return 1 - (solver.progress || 0)
  }

  generateSolver(hyperParameters: any): IntraNodeRouteSolver {
    // Each grow/shrink attempt owns a distinct node and portfolio. Keep this
    // shared data local so later attempts and caller edits are recomputed.
    this.precomputedIntraNodeRouteParams ??= precomputeIntraNodeRouteParams(
      this.nodeWithPortPoints,
    )
    if (hyperParameters.SINGLE_LAYER_NO_DIFFERENT_ROOT_INTERSECTIONS) {
      if (
        !SingleLayerNoDifferentRootIntersectionsIntraNodeSolver.isApplicable(
          this.nodeWithPortPoints,
        )
      ) {
        const ineligibleSolver = new IntraNodeRouteSolver({
          nodeWithPortPoints: this.nodeWithPortPoints,
          connMap: this.connMap,
          traceWidth: this.constructorParams.traceWidth,
          viaDiameter: this.constructorParams.viaDiameter,
          obstacleMargin: this.constructorParams.obstacleMargin,
          precomputedIntraNodeRouteParams: this.precomputedIntraNodeRouteParams,
        })
        ineligibleSolver.failed = true
        ineligibleSolver.error =
          "Single-layer no-different-root-intersection solver not applicable"
        return ineligibleSolver as any
      }

      return new SingleLayerNoDifferentRootIntersectionsIntraNodeSolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        traceWidth: this.constructorParams.traceWidth,
        viaDiameter: this.constructorParams.viaDiameter,
      }) as any
    }

    if (hyperParameters.HIGH_DENSITY_A13) {
      const maxSearchIterations = Math.max(
        1,
        Math.round(50_000_000 * this.effort),
      )
      const solver = new HighDensitySolverA13WithDrcValidation({
        obstacles: this.constructorParams.obstacles ?? [],
        boardGeometry: this.constructorParams.boardGeometry,
        connMap: this.connMap,
        layerCount: this.constructorParams.layerCount ?? 2,
        nodeWithPortPoints: this.nodeWithPortPoints,
        cellSizeMm: 0.1,
        viaDiameter: this.constructorParams.viaDiameter ?? 0.3,
        viaMinDistFromBorder: (this.constructorParams.viaDiameter ?? 0.3) / 2,
        traceThickness: this.constructorParams.traceWidth ?? 0.15,
        traceMargin: 0.1,
        // Use the optimized kernel in batches; fitness accounts for search work
        // rather than the number of calls into the kernel.
        stepMultiplier: 1000,
        maxSearchIterations,
        maxRounds: Math.max(1, Math.round(200 * this.effort)),
        hyperParameters: { shuffleSeed: hyperParameters.SHUFFLE_SEED ?? 0 },
      })
      solver.MAX_ITERATIONS = maxSearchIterations * 2
      return solver as any
    }
    if (hyperParameters.HIGH_DENSITY_A01) {
      const A01Solver = this.portfolioMode !== "legacy"
        ? EndpointPreservingHighDensitySolverA01 : HighDensitySolverA01
      const solver = new A01Solver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        cellSizeMm: 0.1,
        viaDiameter: this.constructorParams.viaDiameter ?? 0.3,
        viaMinDistFromBorder: (this.constructorParams.viaDiameter ?? 0.3) / 2,
        traceMargin: 0.1,
        traceThickness: this.constructorParams.traceWidth ?? 0.15,
        effort: this.effort,
        hyperParameters: {
          shuffleSeed: hyperParameters.SHUFFLE_SEED ?? 0,
        },
      })
      return solver as any
    }
    if (hyperParameters.HIGH_DENSITY_A03) {
      if (this.portfolioMode !== "legacy" && (this.constructorParams.traceWidth ?? 0.15) !== 0.1) {
        throw new Error("Corrected portfolio A03 is ineligible unless requested traceWidth is 0.1 mm")
      }
      const solver = new HighDensityA03Solver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        highResolutionCellSize: 0.1,
        highResolutionCellThickness: 8,
        lowResolutionCellSize: 0.4,
        viaDiameter: this.constructorParams.viaDiameter ?? 0.3,
        viaMinDistFromBorder: (this.constructorParams.viaDiameter ?? 0.3) / 2,
        traceMargin: 0.1,
        // This likely needs to be corrected to use the actual trace width-
        // but using anything but 0.1 for traceThickness is causing issues
        // needs more debugging- repro01 in the high-density-a01 repo
        // has a good reproduction
        traceThickness: 0.1, // this.constructorParams.traceWidth ?? 0.15,
        effort: this.effort,
        hyperParameters,
      })
      return solver as any
    }
    if (hyperParameters.CLOSED_FORM_TWO_TRACE_SAME_LAYER) {
      return new TwoCrossingRoutesHighDensitySolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        viaDiameter: this.constructorParams.viaDiameter,
      }) as any
    }
    if (hyperParameters.CLOSED_FORM_TWO_TRACE_TRANSITION_CROSSING) {
      return new SingleTransitionCrossingRouteSolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        viaDiameter: this.constructorParams.viaDiameter,
      }) as any
    }
    if (hyperParameters.CLOSED_FORM_SINGLE_TRANSITION) {
      return new SingleTransitionIntraNodeSolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        viaDiameter: this.constructorParams.viaDiameter,
      }) as any
    }
    if (hyperParameters.THROUGH_OBSTACLE) {
      return new SingleTransitionThroughObstacleIntraNodeSolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        obstacles: this.constructorParams.obstacles,
        connMap: this.connMap,
        layerCount: this.constructorParams.layerCount,
        viaDiameter: this.constructorParams.viaDiameter,
        traceThickness: this.constructorParams.traceWidth,
      }) as any
    }
    if (hyperParameters.MULTI_HEAD_POLYLINE_SOLVER) {
      return new MultiHeadPolyLineIntraNodeSolver3({
        nodeWithPortPoints: this.nodeWithPortPoints,
        connMap: this.connMap,
        hyperParameters: hyperParameters,
        viaDiameter: this.constructorParams.viaDiameter,
      }) as any
    }
    if (hyperParameters.PRIORITY_DAG_FAMILY_SIZE) {
      return new PriorityDagIntraNodeSolver({
        ...this.constructorParams,
        hyperParameters,
        priorityFamilySize: hyperParameters.PRIORITY_DAG_FAMILY_SIZE,
        precomputedIntraNodeRouteParams: this.precomputedIntraNodeRouteParams,
      })
    }
    return new CachedIntraNodeRouteSolver({
      ...this.constructorParams,
      hyperParameters,
      precomputedIntraNodeRouteParams: this.precomputedIntraNodeRouteParams,
    })
  }

  onSolve(solver: SupervisedSolver<IntraNodeRouteSolver>) {
    let routes: HighDensityIntraNodeRoute[]
    if (
      (solver.solver as any) instanceof HighDensitySolverA01 ||
      (solver.solver as any) instanceof HighDensityA03Solver ||
      (solver.solver as any) instanceof HighDensitySolverA13
    ) {
      routes = (solver.solver as any).getOutput()
    } else {
      routes = solver.solver.solvedRoutes
    }
    const routesWithRootConnectionNames = routes.map((route) => {
      const matchingPortPoint = this.nodeWithPortPoints.portPoints.find(
        (p) => p.connectionName === route.connectionName,
      )
      if (matchingPortPoint?.rootConnectionName) {
        return {
          ...route,
          rootConnectionName: matchingPortPoint.rootConnectionName,
        }
      }
      return route
    })

    this.solvedRoutes = repairDisconnectedSameRootPortPoints(
      routesWithRootConnectionNames,
      this.nodeWithPortPoints,
    )
  }
}
