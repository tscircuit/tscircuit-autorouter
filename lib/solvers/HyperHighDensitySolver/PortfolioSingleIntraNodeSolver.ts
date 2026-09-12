import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { CachedIntraNodeRouteSolver } from "../HighDensitySolver/CachedIntraNodeRouteSolver"
import { IntraNodeRouteSolver } from "../HighDensitySolver/IntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver3 } from "../HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { SingleLayerNoDifferentRootIntersectionsIntraNodeSolver } from "../HighDensitySolver/SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
import { SingleTransitionIntraNodeSolver } from "../HighDensitySolver/SingleTransitionIntraNodeSolver"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "../HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import { SingleTransitionCrossingRouteSolver } from "../HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import { TwoCrossingRoutesHighDensitySolver } from "../HighDensitySolver/TwoRouteHighDensitySolver/TwoCrossingRoutesHighDensitySolver"
import { BaseSolver } from "../BaseSolver"
import type { SupervisedSolver } from "../HyperParameterSupervisorSolver"
import { PortfolioSolverAdapter } from "lib/bindings/high-density/PortfolioSolverAdapter"
import { HighDensitySolverAdapter } from "../../../rust/capacity-autorouter-bindings/ts/index"
import { repairDisconnectedSameRootPortPoints } from "./repairDisconnectedSameRootPortPoints"

type PortfolioCandidate = IntraNodeRouteSolver | HighDensitySolverAdapter
  | SingleLayerNoDifferentRootIntersectionsIntraNodeSolver
  | SingleTransitionIntraNodeSolver | SingleTransitionThroughObstacleIntraNodeSolver
  | SingleTransitionCrossingRouteSolver | TwoCrossingRoutesHighDensitySolver
  | MultiHeadPolyLineIntraNodeSolver3

/** Coordinates the native fitness-scheduled portfolio of intra-node solvers. */
export class PortfolioSingleIntraNodeSolver extends BaseSolver {
  supervisedSolvers?: Array<SupervisedSolver<PortfolioCandidate>>
  winningSolver?: PortfolioCandidate
  GREEDY_MULTIPLIER = 5
  MIN_SUBSTEPS = 100
  override getSolverName(): string {
    return "PortfolioSingleIntraNodeSolver"
  }

  constructorParams: ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0]
  solvedRoutes: HighDensityIntraNodeRoute[] = []
  nodeWithPortPoints: NodeWithPortPoints
  connMap?: ConnectivityMap
  effort: number
  adaptiveSearchExpanded = false
  private readonly portfolioAdapter: PortfolioSolverAdapter

  constructor(
    opts: ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0] & {
      effort?: number
    },
  ) {
    super()
    this.nodeWithPortPoints = opts.nodeWithPortPoints
    this.connMap = opts.connMap
    this.constructorParams = opts
    this.effort = opts.effort ?? 1
    this.MAX_ITERATIONS = 20_000_000 * this.effort
    this.GREEDY_MULTIPLIER = 5
    this.MIN_SUBSTEPS = 100
    this.portfolioAdapter = new PortfolioSolverAdapter(this)
  }

  getPortfolioAdapter(): PortfolioSolverAdapter {
    return this.portfolioAdapter
  }

  getCombinationDefs(): string[][] {
    return this.portfolioAdapter.getCombinationDefs()
  }

  getHyperParameterDefs(): Array<{ name: string; possibleValues: Record<string, unknown>[] }> {
    return this.portfolioAdapter.getHyperParameterDefs()
  }

  getHyperParameterCombinations(definitions?: Array<{ name: string; possibleValues: Record<string, unknown>[] }>): Record<string, unknown>[] {
    return this.portfolioAdapter.getHyperParameterCombinations(definitions)
  }

  initializeSolvers(): void {
    this.portfolioAdapter.initialize()
  }

  getSupervisedSolverWithBestFitness(): SupervisedSolver<PortfolioCandidate> | null {
    return this.portfolioAdapter.getBestCandidate()
  }

  getFailureMessage(): string {
    return this.portfolioAdapter.getFailureMessage()
  }

  override _step(): void {
    this.portfolioAdapter.step()
  }

  computeG(solver: PortfolioCandidate): number {
    return this.portfolioAdapter.computeG(solver)
  }

  computeH(solver: PortfolioCandidate): number {
    return this.portfolioAdapter.computeH(solver)
  }

  computeF(g: number, h: number): number {
    return this.portfolioAdapter.computeF(g, h)
  }

  override visualize(): import("graphics-debug").GraphicsObject {
    return this.getSupervisedSolverWithBestFitness()?.solver.visualize()
      ?? { lines: [], circles: [], points: [], rects: [] }
  }

  generateSolver(hyperParameters: any): PortfolioCandidate {
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
        return ineligibleSolver
      }

      return new SingleLayerNoDifferentRootIntersectionsIntraNodeSolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        traceWidth: this.constructorParams.traceWidth,
        viaDiameter: this.constructorParams.viaDiameter,
      })
    }

    if (hyperParameters.HIGH_DENSITY_A01) {
      const props = {
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
      }
      return new HighDensitySolverAdapter("a01", props)
    }
    if (hyperParameters.HIGH_DENSITY_A03) {
      const props = {
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
      }
      return new HighDensitySolverAdapter("a03", props)
    }
    if (hyperParameters.CLOSED_FORM_TWO_TRACE_SAME_LAYER) {
      return new TwoCrossingRoutesHighDensitySolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        viaDiameter: this.constructorParams.viaDiameter,
      })
    }
    if (hyperParameters.CLOSED_FORM_TWO_TRACE_TRANSITION_CROSSING) {
      return new SingleTransitionCrossingRouteSolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        viaDiameter: this.constructorParams.viaDiameter,
      })
    }
    if (hyperParameters.CLOSED_FORM_SINGLE_TRANSITION) {
      return new SingleTransitionIntraNodeSolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        viaDiameter: this.constructorParams.viaDiameter,
      })
    }
    if (hyperParameters.THROUGH_OBSTACLE) {
      return new SingleTransitionThroughObstacleIntraNodeSolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        obstacles: this.constructorParams.obstacles,
        connMap: this.connMap,
        layerCount: this.constructorParams.layerCount,
        viaDiameter: this.constructorParams.viaDiameter,
        traceThickness: this.constructorParams.traceWidth,
      })
    }
    if (hyperParameters.MULTI_HEAD_POLYLINE_SOLVER) {
      return new MultiHeadPolyLineIntraNodeSolver3({
        nodeWithPortPoints: this.nodeWithPortPoints,
        connMap: this.connMap,
        hyperParameters: hyperParameters,
        viaDiameter: this.constructorParams.viaDiameter,
      })
    }
    const props = { ...this.constructorParams, hyperParameters }
    return new CachedIntraNodeRouteSolver(props, this.constructorParams)
  }

  onSolve(solver: NonNullable<PortfolioSingleIntraNodeSolver["supervisedSolvers"]>[number]) {
    let routes: HighDensityIntraNodeRoute[]
    if (solver.solver instanceof HighDensitySolverAdapter) {
      routes = solver.solver.getOutput()
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
