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
  type HyperGraphPatternType,
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
  PATTERN_TYPE: HyperGraphPatternType
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
    this.MIN_SUBSTEPS = 1
  }

  getConstructorParams(): HyperJumperPrepatternSolver2Params {
    return this.constructorParams
  }

  getHyperParameterDefs() {
    const minDimension = Math.min(
      this.nodeWithPortPoints.width,
      this.nodeWithPortPoints.height,
    )
    const maxDimension = Math.max(
      this.nodeWithPortPoints.width,
      this.nodeWithPortPoints.height,
    )

    // 1x2_1206x4 requires ~8mm min and ~12mm max dimension
    const canUse1x2 = minDimension >= 6 && maxDimension >= 10

    // 2x2_1206x4 requires ~14x14mm
    const canUse2x2 = minDimension >= 10

    // 3x1_1206x4 requires ~6mm min and ~18mm max dimension (3 jumpers in a row)
    const canUse3x1 = minDimension >= 6 && maxDimension >= 18

    // 3x2_1206x4 requires ~10mm min and ~18mm max dimension
    const canUse3x2 = minDimension >= 10 && maxDimension >= 18

    // 3x3_1206x4 requires ~18x18mm
    const canUse3x3 = minDimension >= 18 && maxDimension >= 18

    // 4x4_1206x4 requires ~24x24mm
    const canUse4x4 = minDimension >= 24 && maxDimension >= 24

    const canUse6x4 = minDimension >= 24 && maxDimension >= 24

    const canUse8x4 = minDimension >= 32 && maxDimension >= 32

    const patternValues: Array<{ PATTERN_TYPE: HyperGraphPatternType }> = [
      { PATTERN_TYPE: "single_1206x4" },
    ]

    if (canUse1x2) {
      patternValues.push({ PATTERN_TYPE: "1x2_1206x4" })
    }

    if (canUse2x2) {
      patternValues.push({ PATTERN_TYPE: "2x2_1206x4" })
    }

    if (canUse3x1) {
      patternValues.push({ PATTERN_TYPE: "3x1_1206x4" })
    }

    if (canUse3x2) {
      patternValues.push({ PATTERN_TYPE: "3x2_1206x4" })
    }

    if (canUse3x3) {
      patternValues.push({ PATTERN_TYPE: "3x3_1206x4" })
    }

    if (canUse4x4) {
      patternValues.push({ PATTERN_TYPE: "4x4_1206x4" })
    }

    if (canUse6x4) {
      patternValues.push({ PATTERN_TYPE: "6x4_1206x4" })
    }

    if (canUse8x4) {
      patternValues.push({ PATTERN_TYPE: "8x4_1206x4" })
    }

    return [
      {
        name: "pattern",
        // possibleValues: patternValues,
        possibleValues: [{ PATTERN_TYPE: "1x2_1206x4" }],
      },
      {
        name: "orientation",
        possibleValues: [
          { ORIENTATION: "vertical" },
          // { ORIENTATION: "horizontal" },
        ],
      },
    ]
  }

  getCombinationDefs() {
    // Try all combinations of pattern and orientation
    return [["pattern", "orientation"]]
  }

  generateSolver(
    hyperParameters: VariantHyperParameters,
  ): JumperPrepatternSolver2_HyperGraph {
    return new JumperPrepatternSolver2_HyperGraph({
      nodeWithPortPoints: this.nodeWithPortPoints,
      colorMap: this.colorMap,
      traceWidth: this.traceWidth,
      hyperParameters: {
        PATTERN_TYPE: hyperParameters.PATTERN_TYPE,
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
