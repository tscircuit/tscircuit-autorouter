import {
  HighDensitySolverA03 as HighDensityA03Solver,
  HighDensitySolverA01,
} from "@tscircuit/high-density-a01"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { CachedIntraNodeRouteSolver } from "../HighDensitySolver/CachedIntraNodeRouteSolver"
import { HighDensitySolverB02IntraNodeAdapter } from "../HighDensitySolver/high-density-solver-b02-adapter"
import { IntraNodeRouteSolver } from "../HighDensitySolver/IntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver2 } from "../HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import { MultiHeadPolyLineIntraNodeSolver3 } from "../HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { SingleLayerNoDifferentRootIntersectionsIntraNodeSolver } from "../HighDensitySolver/SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
import { SingleTransitionIntraNodeSolver } from "../HighDensitySolver/SingleTransitionIntraNodeSolver"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "../HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import { SingleTransitionCrossingRouteSolver } from "../HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import { TwoCrossingRoutesHighDensitySolver } from "../HighDensitySolver/TwoRouteHighDensitySolver/TwoCrossingRoutesHighDensitySolver"
import {
  HyperParameterSupervisorSolver,
  SupervisedSolver,
} from "../HyperParameterSupervisorSolver"
import { repairDisconnectedSameRootPortPoints } from "./repairDisconnectedSameRootPortPoints"

// Match the existing six-ordering portfolio used by the other intra-node
// solver. The first ordering remains in the normal portfolio; the remaining
// orderings are introduced only after that portfolio spends its dynamically
// derived exploration budget or exhausts all of its candidates.
const ORDERING_SHUFFLE_SEEDS = Array.from({ length: 6 }, (_, seed) => seed)

/** Coordinates a fitness-scheduled portfolio of intra-node routing solvers. */
export class PortfolioSingleIntraNodeSolver extends HyperParameterSupervisorSolver<
  | IntraNodeRouteSolver
  | TwoCrossingRoutesHighDensitySolver
  | SingleTransitionCrossingRouteSolver
  | SingleTransitionIntraNodeSolver
  | SingleTransitionThroughObstacleIntraNodeSolver
  | SingleLayerNoDifferentRootIntersectionsIntraNodeSolver
  | HighDensityA03Solver
  | HighDensitySolverB02IntraNodeAdapter
> {
  override getSolverName(): string {
    return "PortfolioSingleIntraNodeSolver"
  }

  constructorParams: ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0]
  solvedRoutes: HighDensityIntraNodeRoute[] = []
  nodeWithPortPoints: NodeWithPortPoints
  connMap?: ConnectivityMap
  effort: number
  enableHighDensityB02Solver: boolean
  adaptiveSearchExpanded = false

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

  private getCandidateProgress(solver: { progress: number }): number {
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
      ...(this.supervisedSolvers ?? []).map(
        ({ solver }) => solver.MAX_ITERATIONS,
      ),
    )
  }

  constructor(
    opts: ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0] & {
      effort?: number
      enableHighDensityB02Solver?: boolean
    },
  ) {
    super()
    this.nodeWithPortPoints = opts.nodeWithPortPoints
    this.connMap = opts.connMap
    this.constructorParams = opts
    this.effort = opts.effort ?? 1
    this.enableHighDensityB02Solver = opts.enableHighDensityB02Solver ?? false
    this.MAX_ITERATIONS = 20_000_000 * this.effort
    this.GREEDY_MULTIPLIER = 5
    this.MIN_SUBSTEPS = 100
  }

  getCombinationDefs() {
    return [
      ...(this.enableHighDensityB02Solver ? [["highDensityB02"]] : []),
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
    ]
  }

  /**
   * Some external solvers expose an idempotent setup phase that calculates
   * their natural iteration budget from the problem. Running setup here does
   * not advance the solver or give it preference in the portfolio.
   */
  private initializeCandidateBudget(solver: unknown) {
    const setup = (solver as any).setup
    if (typeof setup === "function") setup.call(solver)
  }

  private refreshDynamicIterationLimit() {
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
    this.MAX_ITERATIONS = Math.max(
      this.iterations + 1,
      this.iterations + remainingSupervisorIterations,
    )
    this.stats.dynamicSupervisorIterationLimit = this.MAX_ITERATIONS
  }

  override initializeSolvers() {
    super.initializeSolvers()
    for (const { solver } of this.supervisedSolvers ?? []) {
      this.initializeCandidateBudget(solver)
    }
    this.stats.dynamicExpansionWorkBudget = this.getDynamicExpansionWorkBudget()
    this.refreshDynamicIterationLimit()
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

  override _step() {
    if (!this.supervisedSolvers) this.initializeSolvers()

    if (
      !this.adaptiveSearchExpanded &&
      !this.getSupervisedSolverWithBestFitness()
    ) {
      this.expandAdaptiveSearch()
    }

    super._step()

    if (!this.solved && !this.failed && this.shouldExpandPortfolio()) {
      this.expandAdaptiveSearch()
    }
  }

  computeG(solver: IntraNodeRouteSolver) {
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
      return new HighDensitySolverB02IntraNodeAdapter({
        nodeWithPortPoints: this.nodeWithPortPoints,
        traceWidth: this.constructorParams.traceWidth,
        viaDiameter: this.constructorParams.viaDiameter,
        clearance: 0.1,
        obstacles: this.constructorParams.obstacles,
        effort: this.effort,
      }) as any
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

    if (hyperParameters.HIGH_DENSITY_A01) {
      const solver = new HighDensitySolverA01({
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
      (solver.solver as any) instanceof HighDensityA03Solver ||
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
