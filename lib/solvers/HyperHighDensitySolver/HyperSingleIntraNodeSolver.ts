import {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { CachedIntraNodeRouteSolver } from "../HighDensitySolver/CachedIntraNodeRouteSolver"
import { IntraNodeRouteSolver } from "../HighDensitySolver/IntraNodeSolver"
import {
  HyperParameterSupervisorSolver,
  SupervisedSolver,
} from "../HyperParameterSupervisorSolver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TwoCrossingRoutesHighDensitySolver } from "../HighDensitySolver/TwoRouteHighDensitySolver/TwoCrossingRoutesHighDensitySolver"
import { SingleTransitionCrossingRouteSolver } from "../HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import { SingleTransitionIntraNodeSolver } from "../HighDensitySolver/SingleTransitionIntraNodeSolver"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "../HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver2 } from "../HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import { MultiHeadPolyLineIntraNodeSolver3 } from "../HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import {
  HighDensitySolverA01,
  HighDensitySolverA03 as HighDensityA03Solver,
} from "@tscircuit/high-density-a01"
import { FixedTopologyHighDensityIntraNodeSolver } from "../FixedTopologyHighDensityIntraNodeSolver"
import { SingleLayerNoDifferentRootIntersectionsIntraNodeSolver } from "../HighDensitySolver/SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"

export class HyperSingleIntraNodeSolver extends HyperParameterSupervisorSolver<
  | IntraNodeRouteSolver
  | TwoCrossingRoutesHighDensitySolver
  | SingleTransitionCrossingRouteSolver
  | SingleTransitionIntraNodeSolver
  | SingleTransitionThroughObstacleIntraNodeSolver
  | FixedTopologyHighDensityIntraNodeSolver
  | SingleLayerNoDifferentRootIntersectionsIntraNodeSolver
  | HighDensityA03Solver
> {
  override getSolverName(): string {
    return "HyperSingleIntraNodeSolver"
  }

  constructorParams: ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0]
  solvedRoutes: HighDensityIntraNodeRoute[] = []
  nodeWithPortPoints: NodeWithPortPoints
  connMap?: ConnectivityMap
  effort: number

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
      ["highDensityA03"],
      ["fixedTopologyHighDensityIntraNodeSolver"],
    ]
  }

  getHyperParameterDefs() {
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
        possibleValues: [
          {
            SHUFFLE_SEED: 0,
          },
          {
            SHUFFLE_SEED: 1,
          },
          {
            SHUFFLE_SEED: 2,
          },
          {
            SHUFFLE_SEED: 3,
          },
          {
            SHUFFLE_SEED: 4,
          },
          {
            SHUFFLE_SEED: 5,
          },
        ],
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
          },
        ],
      },
      {
        name: "fixedTopologyHighDensityIntraNodeSolver",
        possibleValues: [
          {
            FIXED_TOPOLOGY_HIGH_DENSITY_INTRA_NODE_SOLVER: true,
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
    return 1 - (solver.progress || 0)
  }

  generateSolver(hyperParameters: any): IntraNodeRouteSolver {
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
    if (hyperParameters.FIXED_TOPOLOGY_HIGH_DENSITY_INTRA_NODE_SOLVER) {
      return new FixedTopologyHighDensityIntraNodeSolver({
        nodeWithPortPoints: this.nodeWithPortPoints,
        connMap: this.connMap,
        colorMap: this.constructorParams.colorMap,
        traceWidth: this.constructorParams.traceWidth,
        effort: this.effort,
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
      (solver.solver as any) instanceof HighDensityA03Solver
    ) {
      routes = (solver.solver as any).getOutput()
    } else {
      routes = solver.solver.solvedRoutes
    }
    this.solvedRoutes = routes.map((route) => {
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
  }
}
