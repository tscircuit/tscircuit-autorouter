import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRouteWithJumpers,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { Jumper as SrjJumper } from "../../types/srj-types"
import {
  HyperParameterSupervisorSolver,
  SupervisedSolver,
} from "../HyperParameterSupervisorSolver"
import {
  JumperPrepatternSolver2_HyperGraph,
  type JumperPrepatternSolver2Params,
  JumperPrepatternSolver2HyperParameters,
} from "./JumperPrepatternSolver2_HyperGraph"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export interface HyperJumperPrepatternSolver2Params {
  nodeWithPortPoints: NodeWithPortPoints
  colorMap?: Record<string, string>
  traceWidth?: number
  connMap?: ConnectivityMap
  hyperParameters?: JumperPrepatternSolver2HyperParameters
}

type VariantHyperParameters = {
  COLS: number
  ROWS: number
  ORIENTATION: "horizontal" | "vertical"
}

/**
 * HyperJumperPrepatternSolver2 runs multiple variants of JumperPrepatternSolver2_HyperGraph
 * with different pattern types and orientations, then picks the best solution.
 *
 * Variants:
 * - single_1206x4_vertical
 * - single_1206x4_horizontal
 * - 2x2_1206x4_vertical (only if node is large enough, ~14x14mm)
 * - 2x2_1206x4_horizontal (only if node is large enough, ~14x14mm)
 */
export class HyperJumperPrepatternSolver2 extends HyperParameterSupervisorSolver<JumperPrepatternSolver2_HyperGraph> {
  constructorParams: HyperJumperPrepatternSolver2Params
  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  traceWidth: number
  connMap?: ConnectivityMap
  baseHyperParameters?: JumperPrepatternSolver2HyperParameters

  // Output
  solvedRoutes: HighDensityIntraNodeRouteWithJumpers[] = []
  // All jumpers from the winning solver (SRJ format with connectedTo populated)
  jumpers: SrjJumper[] = []

  constructor(params: HyperJumperPrepatternSolver2Params) {
    super()
    this.constructorParams = params
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.colorMap = params.colorMap ?? {}
    this.traceWidth = params.traceWidth ?? 0.15
    this.connMap = params.connMap
    this.baseHyperParameters = params.hyperParameters ?? {}
    this.MAX_ITERATIONS = 1e6
    this.GREEDY_MULTIPLIER = 1
    this.MIN_SUBSTEPS = 1000
  }

  getConstructorParams(): HyperJumperPrepatternSolver2Params {
    return this.constructorParams
  }

  getHyperParameterDefs() {
    return [
      {
        name: "cols",
        possibleValues: [
          { COLS: 1 },
          { COLS: 2 },
          { COLS: 3 },
          { COLS: 4 },
          { COLS: 6 },
          { COLS: 8 },
        ],
      },
      {
        name: "rows",
        possibleValues: [{ ROWS: 1 }, { ROWS: 2 }, { ROWS: 3 }, { ROWS: 4 }],
      },
      {
        name: "orientation",
        possibleValues: [
          { ORIENTATION: "vertical" },
          { ORIENTATION: "horizontal" },
        ],
      },
    ]
  }

  getCombinationDefs() {
    // Try all combinations of cols, rows, and orientation
    return [["cols", "rows", "orientation"]]
  }

  generateSolver(
    hyperParameters: VariantHyperParameters,
  ): JumperPrepatternSolver2_HyperGraph {
    return new JumperPrepatternSolver2_HyperGraph({
      nodeWithPortPoints: this.nodeWithPortPoints,
      colorMap: this.colorMap,
      traceWidth: this.traceWidth,
      hyperParameters: {
        COLS: hyperParameters.COLS,
        ROWS: hyperParameters.ROWS,
        ORIENTATION: hyperParameters.ORIENTATION,
      },
    })
  }

  computeG(solver: JumperPrepatternSolver2_HyperGraph): number {
    // Prefer solutions with fewer iterations
    return solver.iterations / 10000
  }

  computeH(solver: JumperPrepatternSolver2_HyperGraph): number {
    // Estimate remaining work based on progress
    return 1 - (solver.progress || 0)
  }

  onSolve(solver: SupervisedSolver<JumperPrepatternSolver2_HyperGraph>) {
    this.solvedRoutes = solver.solver.solvedRoutes
    this.jumpers = solver.solver.getOutputJumpers()
  }

  getOutput(): HighDensityIntraNodeRouteWithJumpers[] {
    return this.solvedRoutes
  }

  getOutputJumpers(): SrjJumper[] {
    return this.jumpers
  }

  visualize(): GraphicsObject {
    if (this.winningSolver) {
      return this.winningSolver.visualize()
    }
    return super.visualize()
  }
}
