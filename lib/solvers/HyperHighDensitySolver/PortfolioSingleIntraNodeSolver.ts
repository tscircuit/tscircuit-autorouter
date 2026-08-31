import {
  HighDensitySolverA03 as HighDensityA03Solver,
  HighDensitySolverA01,
} from "@tscircuit/high-density-a01"
import { HighDensitySolverA01 as HighDensitySolverA01Next } from "@tscircuit/high-density-a01-next"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { CachedIntraNodeRouteSolver } from "../HighDensitySolver/CachedIntraNodeRouteSolver"
import {
  HighDensitySolverA11,
  HighDensitySolverA12,
} from "../HighDensitySolver/official-high-density-a11-a12"
import {
  HighDensitySolverA08IntraNodeAdapter,
  type HighDensitySolverA08IntraNodeAdapterParams,
} from "../HighDensitySolver/high-density-solver-a08-adapter"
import {
  HighDensitySolverB02IntraNodeAdapter,
  type HighDensitySolverB02IntraNodeAdapterParams,
} from "../HighDensitySolver/high-density-solver-b02-adapter"
import { IntraNodeRouteSolver } from "../HighDensitySolver/IntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver2 } from "../HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import { MultiHeadPolyLineIntraNodeSolver3 } from "../HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { SingleLayerNoDifferentRootIntersectionsIntraNodeSolver } from "../HighDensitySolver/SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
import { SingleTransitionIntraNodeSolver } from "../HighDensitySolver/SingleTransitionIntraNodeSolver"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "../HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import { SingleTransitionCrossingRouteSolver } from "../HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import { TwoCrossingRoutesHighDensitySolver } from "../HighDensitySolver/TwoRouteHighDensitySolver/TwoCrossingRoutesHighDensitySolver"
import {
  getHighDensityIntraNodeRoutePairConnectivityError,
  getHighDensityIntraNodeRouteValidationError,
  materializeHighDensityIntraNodeRouteVias,
} from "../HighDensitySolver/validate-high-density-intra-node-routes"
import {
  HyperParameterSupervisorSolver,
  SupervisedSolver,
} from "../HyperParameterSupervisorSolver"
import { repairDisconnectedSameRootPortPoints } from "./repairDisconnectedSameRootPortPoints"

const ORDERING_SHUFFLE_SEEDS = Array.from({ length: 6 }, (_, seed) => seed)
// These orderings solve complementary forced-growth topologies in
// SRJ18. The remaining orderings stay behind the adaptive expansion budget.
const INITIAL_NEXT_A01_SHUFFLE_SEEDS = [2, 5]
const DEFERRED_NEXT_A01_SHUFFLE_SEEDS = [0, 1, 3, 4]
const DEFERRED_LEGACY_A01_SHUFFLE_SEEDS = ORDERING_SHUFFLE_SEEDS.slice(1)
const A08_DENSE_NODE_PAIR_COUNT = 19
const PRIORITIZED_NEXT_SOLVER_FITNESS_PENALTY = 0.25
// Give compatibility pipelines a substantial legacy head start while leaving
// every next-generation candidate available when the legacy portfolio stalls.
const COMPATIBILITY_NEXT_SOLVER_FITNESS_PENALTY = 6

const getTrustedRootConnectionName = (portPoint: {
  connectionName: string
  rootConnectionName?: string
}): string =>
  portPoint.rootConnectionName ??
  portPoint.connectionName.replace(/_mst\d+$/, "")

type PortfolioSingleIntraNodeSolverParams = ConstructorParameters<
  typeof CachedIntraNodeRouteSolver
>[0] & {
  effort?: number
  validateDuplicateConnectionPairs?: boolean
  prioritizeNextGenerationSolvers?: boolean
  /**
   * Keep next-generation candidates present but let a parent retry different
   * geometry before this portfolio activates them as terminal fallbacks.
   */
  deferNextGenerationSolversToParentRetry?: boolean
  supervisorIterationLimit?: number
  /** Internal grow/shrink gate: A11/A12 are native-size candidates only. */
  includeNativeSizeA11A12?: boolean
}

/** Coordinates a fitness-scheduled portfolio of intra-node routing solvers. */
export class PortfolioSingleIntraNodeSolver extends HyperParameterSupervisorSolver<
  | IntraNodeRouteSolver
  | TwoCrossingRoutesHighDensitySolver
  | SingleTransitionCrossingRouteSolver
  | SingleTransitionIntraNodeSolver
  | SingleTransitionThroughObstacleIntraNodeSolver
  | SingleLayerNoDifferentRootIntersectionsIntraNodeSolver
  | HighDensityA03Solver
  | HighDensitySolverA08IntraNodeAdapter
  | HighDensitySolverB02IntraNodeAdapter
> {
  override getSolverName(): string {
    return "PortfolioSingleIntraNodeSolver"
  }

  constructorParams: PortfolioSingleIntraNodeSolverParams
  solvedRoutes: HighDensityIntraNodeRoute[] = []
  nodeWithPortPoints: NodeWithPortPoints
  connMap?: ConnectivityMap
  effort: number
  adaptiveSearchExpanded = false
  compatibilityNextGenerationCandidatesActivated = false
  private initializedCandidateBudgets = new WeakSet<object>()
  private observedCandidateIterationLimits = new WeakMap<object, number>()

  private isNextGenerationSolver(solver: unknown): boolean {
    return (
      (solver as any) instanceof HighDensitySolverA08IntraNodeAdapter ||
      (solver as any) instanceof HighDensitySolverA12 ||
      (solver as any) instanceof HighDensitySolverA11 ||
      (solver as any) instanceof HighDensitySolverA01Next
    )
  }

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
    return Math.max(
      1,
      this.nodeWithPortPoints.portPointsInPairs?.length ??
        new Set(
          this.nodeWithPortPoints.portPoints.map(
            (portPoint) => portPoint.connectionName,
          ),
        ).size,
    )
  }

  private hasDuplicateExpectedPairConnectionName(): boolean {
    const seenConnectionNames = new Set<string>()
    for (const [start] of this.nodeWithPortPoints.portPointsInPairs ?? []) {
      if (seenConnectionNames.has(start.connectionName)) return true
      seenConnectionNames.add(start.connectionName)
    }
    return false
  }

  private getCandidateProgress(solver: { progress: number }): number {
    if (
      this.isNextGenerationSolver(solver) &&
      !this.initializedCandidateBudgets.has(solver as object)
    ) {
      return 0
    }
    const solvedSegmentCount = this.getSolvedSegmentCount(solver)
    if (solvedSegmentCount !== null) {
      return Math.min(1, solvedSegmentCount / this.getNodeSegmentCount())
    }
    return Math.max(0, Math.min(1, solver.progress || 0))
  }

  private getTotalCandidateWork(): number {
    return (this.supervisedSolvers ?? []).reduce(
      (total, { solver }) => total + solver.iterations,
      0,
    )
  }

  private getDynamicExpansionWorkBudget(): number {
    // Give the initial portfolio as much aggregate work as its most expensive
    // candidate could consume alone. This scales with the candidate's own
    // problem- and effort-derived budget without waiting for every candidate
    // to fail or introducing a wall-clock iteration constant.
    return Math.max(
      1,
      ...(this.supervisedSolvers ?? [])
        .filter(({ f }) => Number.isFinite(f))
        .map(({ solver }) => solver.MAX_ITERATIONS),
    )
  }

  constructor(opts: PortfolioSingleIntraNodeSolverParams) {
    super()
    this.nodeWithPortPoints = opts.nodeWithPortPoints
    this.connMap = opts.connMap
    this.constructorParams = opts
    this.effort = opts.effort ?? 1
    this.MAX_ITERATIONS = 20_000_000 * this.effort
    this.GREEDY_MULTIPLIER = 5
    this.MIN_SUBSTEPS = 100
  }

  private getB02Params(): HighDensitySolverB02IntraNodeAdapterParams {
    return {
      nodeWithPortPoints: this.nodeWithPortPoints,
      traceWidth: this.constructorParams.traceWidth,
      viaDiameter: this.constructorParams.viaDiameter,
      clearance: 0.1,
      obstacles: this.constructorParams.obstacles,
      effort: this.effort,
      minimumPairCount: 8,
    }
  }

  private getA08Params(
    inputStrategy: "explicit-pairs" | "shared-anchors",
    shuffleSeed: number,
  ): HighDensitySolverA08IntraNodeAdapterParams {
    return {
      nodeWithPortPoints: this.nodeWithPortPoints,
      traceWidth: this.constructorParams.traceWidth,
      viaDiameter: this.constructorParams.viaDiameter,
      traceMargin: inputStrategy === "explicit-pairs" ? 0.12 : 0.1,
      obstacles: this.constructorParams.obstacles,
      effort: this.effort,
      minimumPairCount: 2,
      inputStrategy,
      shuffleSeed,
    }
  }

  getCombinationDefs() {
    const a08ExplicitPairParams = this.getA08Params("explicit-pairs", 5)
    const a08SharedAnchorParams = this.getA08Params("shared-anchors", 4)
    return [
      ["highDensityB02"],
      ...(HighDensitySolverA08IntraNodeAdapter.isApplicable(
        a08ExplicitPairParams,
      )
        ? [["highDensityA08ExplicitPairs"]]
        : []),
      ...(HighDensitySolverA08IntraNodeAdapter.isApplicable(
        a08SharedAnchorParams,
      )
        ? [["highDensityA08SharedAnchors"]]
        : []),
      ["throughObstacle"],
      ["singleLayerNoDifferentRootIntersections"],
      ["multiHeadPolyLine"],
      ["majorCombinations", "orderings6", "cellSizeFactor"],
      ["noVias"],
      ["orderings50"],
      ["flipTraceAlignmentDirection", "orderings6"],
      ["closedFormSingleTrace"],
      // ["closedFormTwoTrace"],
      ...(this.constructorParams.includeNativeSizeA11A12 === false
        ? []
        : [["highDensityA12"], ["highDensityA11"]]),
      ["highDensityA01"],
      ["highDensityA01Next"],
      ["highDensityA03"],
    ]
  }

  getHyperParameterDefs() {
    return [
      {
        name: "highDensityB02",
        possibleValues: [{ HIGH_DENSITY_B02: true }],
      },
      {
        name: "highDensityA08ExplicitPairs",
        possibleValues: [
          {
            HIGH_DENSITY_A08: true,
            A08_INPUT_STRATEGY: "explicit-pairs",
            A08_SHUFFLE_SEED: 5,
          },
        ],
      },
      {
        name: "highDensityA08SharedAnchors",
        possibleValues: [
          {
            HIGH_DENSITY_A08: true,
            A08_INPUT_STRATEGY: "shared-anchors",
            A08_SHUFFLE_SEED: 4,
          },
        ],
      },
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
        possibleValues: ORDERING_SHUFFLE_SEEDS.map((shuffleSeed) => ({
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
        possibleValues: Array.from({ length: 20 }, (_, i) => ({
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
        name: "highDensityA12",
        possibleValues: [
          {
            HIGH_DENSITY_A12: true,
            SHUFFLE_SEED: ORDERING_SHUFFLE_SEEDS[0],
          },
        ],
      },
      {
        name: "highDensityA11",
        possibleValues: [
          {
            HIGH_DENSITY_A11: true,
            SHUFFLE_SEED: ORDERING_SHUFFLE_SEEDS[0],
          },
        ],
      },
      {
        name: "highDensityA01",
        possibleValues: [
          {
            HIGH_DENSITY_A01: true,
            SHUFFLE_SEED: 0,
          },
        ],
      },
      {
        name: "highDensityA01Next",
        possibleValues: INITIAL_NEXT_A01_SHUFFLE_SEEDS.map(
          (shuffleSeed) => ({
            HIGH_DENSITY_A01_NEXT: true,
            SHUFFLE_SEED: shuffleSeed,
          }),
        ),
      },
      {
        name: "highDensityA03",
        possibleValues: [
          {
            HIGH_DENSITY_A03: true,
          },
        ],
      },
    ]
  }

  /**
   * Some external solvers expose an idempotent setup phase that calculates
   * their natural iteration budget from the problem. Running setup here does
   * not advance the solver or give it preference in the portfolio.
   */
  private initializeCandidateBudget(solver: unknown): void {
    if (this.initializedCandidateBudgets.has(solver as object)) return
    const setup = (solver as any).setup
    if (typeof setup === "function") setup.call(solver)
    this.initializedCandidateBudgets.add(solver as object)
  }

  private shouldInitializeCandidateBudget(solver: unknown): boolean {
    return (
      this.constructorParams.prioritizeNextGenerationSolvers === true ||
      this.compatibilityNextGenerationCandidatesActivated ||
      !this.isNextGenerationSolver(solver)
    )
  }

  private refreshDynamicIterationLimit(): void {
    const remainingSupervisorIterations = (this.supervisedSolvers ?? []).reduce(
      (total, { solver }) => {
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
    const dynamicIterationLimit = Math.max(
      this.iterations + 1,
      this.iterations + remainingSupervisorIterations,
    )
    const requestedIterationLimit =
      this.constructorParams.supervisorIterationLimit
    const configuredIterationLimit =
      typeof requestedIterationLimit === "number" &&
      Number.isFinite(requestedIterationLimit) &&
      requestedIterationLimit > 0
        ? Math.floor(requestedIterationLimit)
        : null
    this.MAX_ITERATIONS =
      configuredIterationLimit === null
        ? dynamicIterationLimit
        : Math.min(dynamicIterationLimit, configuredIterationLimit)
    this.stats.dynamicSupervisorIterationLimit = this.MAX_ITERATIONS
  }

  override initializeSolvers(): void {
    super.initializeSolvers()
    for (const { solver } of this.supervisedSolvers ?? []) {
      if (this.shouldInitializeCandidateBudget(solver)) {
        this.initializeCandidateBudget(solver)
      }
      this.observedCandidateIterationLimits.set(
        solver,
        solver.MAX_ITERATIONS,
      )
    }
    this.stats.dynamicExpansionWorkBudget = this.getDynamicExpansionWorkBudget()
    this.refreshDynamicIterationLimit()
  }

  private addSupervisedCandidate(
    hyperParameters: Record<string, any>,
  ): void {
    const solver = this.generateSolver(hyperParameters)
    if (this.shouldInitializeCandidateBudget(solver)) {
      this.initializeCandidateBudget(solver)
    }
    this.observedCandidateIterationLimits.set(solver, solver.MAX_ITERATIONS)
    const g = this.computeG(solver)
    this.supervisedSolvers!.push({
      hyperParameters,
      solver,
      h: 0,
      g,
      f: g,
    })
  }

  private expandAdaptiveSearch(): void {
    if (this.adaptiveSearchExpanded) return

    this.adaptiveSearchExpanded = true
    // Compatibility pipelines retain the historical adaptive A01 orderings;
    // the Next A01 candidates below are still present in every portfolio.
    if (!this.constructorParams.prioritizeNextGenerationSolvers) {
      for (const shuffleSeed of DEFERRED_LEGACY_A01_SHUFFLE_SEEDS) {
        this.addSupervisedCandidate({
          HIGH_DENSITY_A01: true,
          SHUFFLE_SEED: shuffleSeed,
        })
      }
    }
    for (const shuffleSeed of DEFERRED_NEXT_A01_SHUFFLE_SEEDS) {
      this.addSupervisedCandidate({
        HIGH_DENSITY_A01_NEXT: true,
        SHUFFLE_SEED: shuffleSeed,
      })
    }
    this.refreshDynamicIterationLimit()
    this.stats.adaptiveSearchExpanded = true
    this.stats.adaptiveSearchExpandedAtIteration = this.iterations
    this.stats.candidateWorkAtExpansion = this.getTotalCandidateWork()
    this.stats.bestProgressAtExpansion = Math.max(
      0,
      ...(this.supervisedSolvers ?? []).map(({ solver }) =>
        this.getCandidateProgress(solver),
      ),
    )
  }

  private shouldExpandPortfolio(): boolean {
    if (this.adaptiveSearchExpanded) return false

    const expansionWorkBudget = this.getDynamicExpansionWorkBudget()
    this.stats.dynamicExpansionWorkBudget = expansionWorkBudget
    return this.getTotalCandidateWork() >= expansionWorkBudget
  }

  private refreshIfCandidateIterationLimitChanged(): void {
    const activeCandidate = this.activeSubSolver
    if (!activeCandidate || this.solved || this.failed) return
    const observedLimit = this.observedCandidateIterationLimits.get(
      activeCandidate,
    )
    if (observedLimit === activeCandidate.MAX_ITERATIONS) return
    this.observedCandidateIterationLimits.set(
      activeCandidate,
      activeCandidate.MAX_ITERATIONS,
    )
    this.refreshDynamicIterationLimit()
  }

  private activateCompatibilityNextGenerationCandidates(): void {
    if (this.compatibilityNextGenerationCandidatesActivated) return

    this.compatibilityNextGenerationCandidatesActivated = true
    for (const supervisedSolver of this.supervisedSolvers ?? []) {
      if (!this.isNextGenerationSolver(supervisedSolver.solver)) continue
      const candidateSolver = supervisedSolver.solver as IntraNodeRouteSolver
      this.initializeCandidateBudget(candidateSolver)
      this.observedCandidateIterationLimits.set(
        candidateSolver,
        candidateSolver.MAX_ITERATIONS,
      )
      supervisedSolver.g = this.computeG(candidateSolver)
      supervisedSolver.h = this.computeH(candidateSolver)
      supervisedSolver.f = this.computeF(
        supervisedSolver.g,
        supervisedSolver.h,
      )
    }
    this.refreshDynamicIterationLimit()
    this.stats.compatibilityNextGenerationCandidatesActivated = true
    this.stats.compatibilityNextGenerationCandidatesActivatedAtIteration =
      this.iterations
  }

  rejectCurrentSolution(error: string): boolean {
    const winningSolver = this.winningSolver
    const winningCandidate = this.supervisedSolvers?.find(
      ({ solver }) => solver === winningSolver,
    )
    if (!winningSolver || !winningCandidate) return false

    winningSolver.solved = false
    winningSolver.failed = true
    winningSolver.error = error
    this.solved = false
    this.failed = false
    this.error = null
    this.winningSolver = undefined
    this.activeSubSolver = null
    this.solvedRoutes = []
    this.stats.rejectedByParentValidatorCount =
      Number(this.stats.rejectedByParentValidatorCount ?? 0) + 1
    this.refreshDynamicIterationLimit()
    return true
  }

  override _step(): void {
    if (!this.supervisedSolvers) this.initializeSolvers()

    if (
      !this.adaptiveSearchExpanded &&
      !this.getSupervisedSolverWithBestFitness()
    ) {
      this.expandAdaptiveSearch()
    }

    if (
      !this.constructorParams.prioritizeNextGenerationSolvers &&
      !this.constructorParams.deferNextGenerationSolversToParentRetry &&
      this.adaptiveSearchExpanded &&
      !this.getSupervisedSolverWithBestFitness()
    ) {
      this.activateCompatibilityNextGenerationCandidates()
    }

    super._step()
    this.refreshIfCandidateIterationLimitChanged()

    if (!this.solved && !this.failed && this.shouldExpandPortfolio()) {
      this.expandAdaptiveSearch()
    }
  }

  computeG(solver: IntraNodeRouteSolver) {
    if (
      this.isNextGenerationSolver(solver) &&
      !this.constructorParams.prioritizeNextGenerationSolvers &&
      !this.compatibilityNextGenerationCandidatesActivated
    ) {
      return Number.POSITIVE_INFINITY
    }
    const nextSolverFitnessPenalty = this.constructorParams
      .prioritizeNextGenerationSolvers
      ? PRIORITIZED_NEXT_SOLVER_FITNESS_PENALTY
      : COMPATIBILITY_NEXT_SOLVER_FITNESS_PENALTY
    if ((solver as any) instanceof HighDensitySolverA08IntraNodeAdapter) {
      const pairCount = this.nodeWithPortPoints.portPointsInPairs?.length ?? 0
      const densityPriorityPenalty = Math.max(
        0,
        (A08_DENSE_NODE_PAIR_COUNT - pairCount) / 2,
      )
      return (
        nextSolverFitnessPenalty +
        densityPriorityPenalty +
        solver.iterations / 1_000_000
      )
    }
    if (
      (solver as any) instanceof HighDensitySolverA01Next ||
      (solver as any) instanceof HighDensitySolverA12 ||
      (solver as any) instanceof HighDensitySolverA11
    ) {
      return (
        nextSolverFitnessPenalty +
        (solver as any).iterations / 1_000_000
      )
    }
    if (
      (solver as any) instanceof HighDensitySolverA01 ||
      (solver as any) instanceof HighDensityA03Solver
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

  computeH(solver: IntraNodeRouteSolver) {
    if (this.adaptiveSearchExpanded) {
      return 1 - this.getCandidateProgress(solver)
    }
    return 1 - (solver.progress || 0)
  }

  generateSolver(hyperParameters: any): IntraNodeRouteSolver {
    if (hyperParameters.HIGH_DENSITY_B02) {
      return new HighDensitySolverB02IntraNodeAdapter(
        this.getB02Params(),
      ) as any
    }

    if (hyperParameters.HIGH_DENSITY_A08) {
      const params = this.getA08Params(
        hyperParameters.A08_INPUT_STRATEGY ?? "explicit-pairs",
        hyperParameters.A08_SHUFFLE_SEED ?? 0,
      )
      if (!HighDensitySolverA08IntraNodeAdapter.isApplicable(params)) {
        throw new Error(
          "HighDensitySolverA08IntraNodeAdapter was created for an inapplicable node",
        )
      }
      return new HighDensitySolverA08IntraNodeAdapter(params) as any
    }

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

    if (hyperParameters.HIGH_DENSITY_A12) {
      return new HighDensitySolverA12({
        nodeWithPortPoints: this.nodeWithPortPoints,
        viaDiameter: this.constructorParams.viaDiameter ?? 0.3,
        viaMinDistFromBorder: (this.constructorParams.viaDiameter ?? 0.3) / 2,
        traceMargin: 0.1,
        traceThickness: this.constructorParams.traceWidth ?? 0.15,
        effort: this.effort,
        hyperParameters: {
          shuffleSeed: hyperParameters.SHUFFLE_SEED ?? 0,
        },
      }) as any
    }

    if (hyperParameters.HIGH_DENSITY_A11) {
      return new HighDensitySolverA11({
        nodeWithPortPoints: this.nodeWithPortPoints,
        viaDiameter: this.constructorParams.viaDiameter ?? 0.3,
        viaMinDistFromBorder: (this.constructorParams.viaDiameter ?? 0.3) / 2,
        traceMargin: 0.1,
        traceThickness: this.constructorParams.traceWidth ?? 0.15,
        effort: this.effort,
        hyperParameters: {
          shuffleSeed: hyperParameters.SHUFFLE_SEED ?? 0,
        },
      }) as any
    }

    if (
      hyperParameters.HIGH_DENSITY_A01 ||
      hyperParameters.HIGH_DENSITY_A01_NEXT
    ) {
      const SolverClass = hyperParameters.HIGH_DENSITY_A01_NEXT
        ? HighDensitySolverA01Next
        : HighDensitySolverA01
      const solver = new SolverClass({
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
        traceThickness: this.constructorParams.traceWidth,
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
    return new CachedIntraNodeRouteSolver({
      ...this.constructorParams,
      hyperParameters,
    })
  }

  onSolve(solver: SupervisedSolver<IntraNodeRouteSolver>) {
    let routes: HighDensityIntraNodeRoute[]
    if (
      (solver.solver as any) instanceof HighDensitySolverA01 ||
      (solver.solver as any) instanceof HighDensitySolverA01Next ||
      (solver.solver as any) instanceof HighDensityA03Solver ||
      (solver.solver as any) instanceof HighDensitySolverA12 ||
      (solver.solver as any) instanceof HighDensitySolverA11 ||
      (solver.solver as any) instanceof HighDensitySolverA08IntraNodeAdapter ||
      (solver.solver as any) instanceof HighDensitySolverB02IntraNodeAdapter
    ) {
      routes = (solver.solver as any).getOutput()
    } else {
      routes = solver.solver.solvedRoutes
    }
    const routesWithRootConnectionNames = routes.map((route) => {
      const matchingPortPoint = this.nodeWithPortPoints.portPoints.find(
        (p) => p.connectionName === route.connectionName,
      )
      if (matchingPortPoint) {
        return {
          ...route,
          rootConnectionName:
            getTrustedRootConnectionName(matchingPortPoint),
          regionId: this.nodeWithPortPoints.capacityMeshNodeId,
        }
      }
      return {
        ...route,
        regionId: this.nodeWithPortPoints.capacityMeshNodeId,
      }
    })

    let repairedRoutes = repairDisconnectedSameRootPortPoints(
      routesWithRootConnectionNames,
      this.nodeWithPortPoints,
    )
    const requiresExternalCandidateValidation =
      solver.hyperParameters.HIGH_DENSITY_A01_NEXT === true ||
      solver.hyperParameters.HIGH_DENSITY_A12 === true ||
      solver.hyperParameters.HIGH_DENSITY_A11 === true
    if (requiresExternalCandidateValidation) {
      repairedRoutes = repairedRoutes.map(
        materializeHighDensityIntraNodeRouteVias,
      )
      const validationError = getHighDensityIntraNodeRouteValidationError({
        routes: repairedRoutes,
        nodeWithPortPoints: this.nodeWithPortPoints,
        requirePairConnectivity: true,
        expectedTraceThickness:
          this.constructorParams.traceWidth ?? 0.15,
        expectedViaDiameter:
          this.constructorParams.viaDiameter ?? 0.3,
      })
      if (validationError) {
        solver.solver.solved = false
        solver.solver.failed = true
        solver.solver.error = `${solver.solver.getSolverName()} output rejected: ${validationError}`
        this.solved = false
        this.winningSolver = undefined
        this.stats.rejectedExternalCandidateCount =
          Number(this.stats.rejectedExternalCandidateCount ?? 0) + 1
        this.refreshDynamicIterationLimit()
        return
      }
    } else if (
      this.constructorParams.validateDuplicateConnectionPairs &&
      this.hasDuplicateExpectedPairConnectionName()
    ) {
      const pairConnectivityError =
        getHighDensityIntraNodeRoutePairConnectivityError(
          repairedRoutes,
          this.nodeWithPortPoints,
        )
      if (pairConnectivityError) {
        solver.solver.solved = false
        solver.solver.failed = true
        solver.solver.error = `${solver.solver.getSolverName()} output rejected: ${pairConnectivityError}`
        this.solved = false
        this.winningSolver = undefined
        this.stats.rejectedPairConnectivityCandidateCount =
          Number(this.stats.rejectedPairConnectivityCandidateCount ?? 0) + 1
        this.refreshDynamicIterationLimit()
        return
      }
    }

    this.solvedRoutes = repairedRoutes
  }
}
