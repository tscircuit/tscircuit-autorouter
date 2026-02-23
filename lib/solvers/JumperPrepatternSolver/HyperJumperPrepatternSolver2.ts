import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import type {
  HighDensityIntraNodeRouteWithJumpers,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { JumperType, Jumper as SrjJumper } from "../../types/srj-types"
import {
  HyperParameterSupervisorSolver,
  SupervisedSolver,
} from "../HyperParameterSupervisorSolver"
import {
  JumperPrepatternSolver2HyperParameters,
  type JumperPrepatternSolver2Params,
  JumperPrepatternSolver2_HyperGraph,
} from "./JumperPrepatternSolver2_HyperGraph"

export interface HyperJumperPrepatternSolver2Params {
  nodeWithPortPoints: NodeWithPortPoints
  colorMap?: Record<string, string>
  traceWidth?: number
  obstacleMargin?: number
  connMap?: ConnectivityMap
  hyperParameters?: JumperPrepatternSolver2HyperParameters
  /** Available jumper types. Defaults to ["0603"] */
  availableJumperTypes?: JumperType[]
}

type VariantHyperParameters = {
  COLS: number
  ROWS: number
  ORIENTATION: "horizontal" | "vertical"
  JUMPER_TYPE: JumperType
  PATTERN?: "grid" | "staggered"
  TRACE_CHANNELS_BETWEEN_JUMPERS?: number
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
  obstacleMargin: number
  connMap?: ConnectivityMap
  baseHyperParameters?: JumperPrepatternSolver2HyperParameters
  availableJumperTypes: JumperType[]

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
    this.obstacleMargin = params.obstacleMargin ?? 0.15
    this.connMap = params.connMap
    this.baseHyperParameters = params.hyperParameters ?? {}
    this.availableJumperTypes = params.availableJumperTypes ?? ["0603"]
    this.MAX_ITERATIONS = 1e6
    this.GREEDY_MULTIPLIER = 1
    this.MIN_SUBSTEPS = 1000
  }

  getConstructorParams(): HyperJumperPrepatternSolver2Params {
    return this.constructorParams
  }

  getHyperParameterDefs() {
    const defs: Array<{
      name: string
      possibleValues: Array<Record<string, any>>
    }> = []

    const node = this.nodeWithPortPoints

    const max0603VertOneTrace = this.calculateMax0603ConfigWithTraceChannels(
      node.width,
      node.height,
      "vertical",
      1,
    )
    defs.push({
      name: "0603_max_rows_and_cols_vert_1trace_grid",
      possibleValues: [
        {
          JUMPER_TYPE: "0603" as JumperType,
          COLS: max0603VertOneTrace.cols,
          ROWS: max0603VertOneTrace.rows,
          ORIENTATION: "vertical" as const,
          PATTERN: "grid" as const,
          TRACE_CHANNELS_BETWEEN_JUMPERS: 1,
        },
      ],
    })

    const max0603VertOneTraceStaggered =
      this.calculateMax0603ConfigWithTraceChannels(
        node.width,
        node.height,
        "vertical",
        1,
        "staggered",
      )
    defs.push({
      name: "0603_max_rows_and_cols_vert_1trace_staggered",
      possibleValues: [
        {
          JUMPER_TYPE: "0603" as JumperType,
          COLS: max0603VertOneTraceStaggered.cols,
          ROWS: max0603VertOneTraceStaggered.rows,
          ORIENTATION: "vertical" as const,
          PATTERN: "staggered" as const,
          TRACE_CHANNELS_BETWEEN_JUMPERS: 1,
        },
      ],
    })

    const max0603VertTwoTrace = this.calculateMax0603ConfigWithTraceChannels(
      node.width,
      node.height,
      "vertical",
      2,
    )
    defs.push({
      name: "0603_max_rows_and_cols_vert_2trace_grid",
      possibleValues: [
        {
          JUMPER_TYPE: "0603" as JumperType,
          COLS: max0603VertTwoTrace.cols,
          ROWS: max0603VertTwoTrace.rows,
          ORIENTATION: "vertical" as const,
          PATTERN: "grid" as const,
          TRACE_CHANNELS_BETWEEN_JUMPERS: 2,
        },
      ],
    })

    const max0603VertTwoTraceStaggered =
      this.calculateMax0603ConfigWithTraceChannels(
        node.width,
        node.height,
        "vertical",
        2,
        "staggered",
      )
    defs.push({
      name: "0603_max_rows_and_cols_vert_2trace_staggered",
      possibleValues: [
        {
          JUMPER_TYPE: "0603" as JumperType,
          COLS: max0603VertTwoTraceStaggered.cols,
          ROWS: max0603VertTwoTraceStaggered.rows,
          ORIENTATION: "vertical" as const,
          PATTERN: "staggered" as const,
          TRACE_CHANNELS_BETWEEN_JUMPERS: 2,
        },
      ],
    })

    const max0603HorzOneTrace = this.calculateMax0603ConfigWithTraceChannels(
      node.width,
      node.height,
      "horizontal",
      1,
    )
    defs.push({
      name: "0603_max_rows_and_cols_horz_1trace_grid",
      possibleValues: [
        {
          JUMPER_TYPE: "0603" as JumperType,
          COLS: max0603HorzOneTrace.cols,
          ROWS: max0603HorzOneTrace.rows,
          ORIENTATION: "horizontal" as const,
          PATTERN: "grid" as const,
          TRACE_CHANNELS_BETWEEN_JUMPERS: 1,
        },
      ],
    })

    const max0603HorzOneTraceStaggered =
      this.calculateMax0603ConfigWithTraceChannels(
        node.width,
        node.height,
        "horizontal",
        1,
        "staggered",
      )
    defs.push({
      name: "0603_max_rows_and_cols_horz_1trace_staggered",
      possibleValues: [
        {
          JUMPER_TYPE: "0603" as JumperType,
          COLS: max0603HorzOneTraceStaggered.cols,
          ROWS: max0603HorzOneTraceStaggered.rows,
          ORIENTATION: "horizontal" as const,
          PATTERN: "staggered" as const,
          TRACE_CHANNELS_BETWEEN_JUMPERS: 1,
        },
      ],
    })

    const max0603HorzTwoTrace = this.calculateMax0603ConfigWithTraceChannels(
      node.width,
      node.height,
      "horizontal",
      2,
    )
    defs.push({
      name: "0603_max_rows_and_cols_horz_2trace_grid",
      possibleValues: [
        {
          JUMPER_TYPE: "0603" as JumperType,
          COLS: max0603HorzTwoTrace.cols,
          ROWS: max0603HorzTwoTrace.rows,
          ORIENTATION: "horizontal" as const,
          PATTERN: "grid" as const,
          TRACE_CHANNELS_BETWEEN_JUMPERS: 2,
        },
      ],
    })

    const max0603HorzTwoTraceStaggered =
      this.calculateMax0603ConfigWithTraceChannels(
        node.width,
        node.height,
        "horizontal",
        2,
        "staggered",
      )
    defs.push({
      name: "0603_max_rows_and_cols_horz_2trace_staggered",
      possibleValues: [
        {
          JUMPER_TYPE: "0603" as JumperType,
          COLS: max0603HorzTwoTraceStaggered.cols,
          ROWS: max0603HorzTwoTraceStaggered.rows,
          ORIENTATION: "horizontal" as const,
          PATTERN: "staggered" as const,
          TRACE_CHANNELS_BETWEEN_JUMPERS: 2,
        },
      ],
    })

    // 1206x4 jumper type
    defs.push({
      name: "1206x4",
      possibleValues: [{ JUMPER_TYPE: "1206x4" as JumperType }],
    })

    // 1206x4 cols and rows
    const colValues1206x4 = [1, 2, 3, 4, 6, 8, 10]
    const rowValues1206x4 = [1, 2, 3, 4, 8]

    defs.push({
      name: "1206x4_cols",
      possibleValues: colValues1206x4.map((c) => ({ COLS: c })),
    })

    defs.push({
      name: "1206x4_rows",
      possibleValues: rowValues1206x4.map((r) => ({ ROWS: r })),
    })

    defs.push({
      name: "orientation",
      possibleValues: [
        { ORIENTATION: "vertical" as const },
        { ORIENTATION: "horizontal" as const },
      ],
    })

    return defs
  }

  /**
   * Filter out invalid row/col combinations for each jumper type.
   * For 0603: only allow 1, 2, 4, 6, 8 for both rows and cols
   * For 1206x4: allow existing values (1, 2, 3, 4, 6, 8, 10 for cols; 1, 2, 3, 4, 8 for rows)
   */
  isValidCombination(hyperParameters: VariantHyperParameters): boolean {
    const { JUMPER_TYPE, COLS, ROWS } = hyperParameters
    const valid0603Values = [1, 2, 4, 6, 8]
    const validCols1206x4 = [1, 2, 3, 4, 6, 8, 10]
    const validRows1206x4 = [1, 2, 3, 4, 8]

    if (JUMPER_TYPE === "0603") {
      return valid0603Values.includes(COLS) && valid0603Values.includes(ROWS)
    } else if (JUMPER_TYPE === "1206x4") {
      return validCols1206x4.includes(COLS) && validRows1206x4.includes(ROWS)
    }
    return false
  }

  getCombinationDefs() {
    // Try all combinations of jumperType, cols, rows, and orientation
    return [
      ["0603_max_rows_and_cols_vert_1trace_grid"],
      ["0603_max_rows_and_cols_vert_1trace_staggered"],
      ["0603_max_rows_and_cols_horz_1trace_grid"],
      ["0603_max_rows_and_cols_horz_1trace_staggered"],
      ["0603_max_rows_and_cols_vert_2trace_grid"],
      ["0603_max_rows_and_cols_vert_2trace_staggered"],
      ["0603_max_rows_and_cols_horz_2trace_grid"],
      ["0603_max_rows_and_cols_horz_2trace_staggered"],
      ["1206x4", "1206x4_cols", "1206x4_rows", "orientation"],
    ]
  }

  private calculateMax0603ConfigWithTraceChannels(
    nodeWidth: number,
    nodeHeight: number,
    orientation: "horizontal" | "vertical",
    traceChannelsBetweenJumpers: number,
    pattern: "grid" | "staggered" = "grid",
  ): { cols: number; rows: number } {
    const padWidth = 0.9
    const padHeight = 1.0
    const padGap = 0.35
    const paddingAroundPads = 0.5
    const clearance =
      this.traceWidth * traceChannelsBetweenJumpers + this.obstacleMargin * 2

    const bodyWidth =
      orientation === "horizontal" ? padWidth * 2 + padGap : padHeight
    const bodyHeight =
      orientation === "horizontal" ? padHeight : padWidth * 2 + padGap
    const staggerAxis: "x" | "y" = orientation === "horizontal" ? "x" : "y"
    const staggerOffset =
      pattern === "staggered" && staggerAxis === "x"
        ? bodyWidth / 2
        : pattern === "staggered"
          ? bodyHeight / 2
          : 0

    const availableWidth = Math.max(0, nodeWidth - paddingAroundPads * 2)
    const availableHeight = Math.max(0, nodeHeight - paddingAroundPads * 2)
    const effectiveAvailableWidth = Math.max(
      0,
      availableWidth -
        (pattern === "staggered" && staggerAxis === "x" ? staggerOffset : 0),
    )
    const effectiveAvailableHeight = Math.max(
      0,
      availableHeight -
        (pattern === "staggered" && staggerAxis === "y" ? staggerOffset : 0),
    )

    const pitchX = bodyWidth + clearance
    const pitchY = bodyHeight + clearance

    const effectiveCols = Math.max(
      1,
      Math.floor(1 + (effectiveAvailableWidth - bodyWidth) / pitchX),
    )
    const effectiveRows = Math.max(
      1,
      Math.floor(1 + (effectiveAvailableHeight - bodyHeight) / pitchY),
    )

    if (orientation === "vertical") {
      return { cols: effectiveCols, rows: effectiveRows }
    }

    return { cols: effectiveRows, rows: effectiveCols }
  }

  /**
   * Override initializeSolvers to use getCombinationDefs for both 0603 and 1206x4.
   * For 0603: uses pre-calculated max rows/cols for each orientation, trace channel count,
   * and pattern (grid/staggered).
   * For 1206x4: uses full combination of cols, rows, and orientation.
   */
  initializeSolvers() {
    const hyperParameterDefs = this.getHyperParameterDefs()
    const combinationDefs = this.getCombinationDefs()

    this.supervisedSolvers = []

    for (const combinationDef of combinationDefs) {
      // Check if this combination applies to our available jumper types
      const is0603Combo = combinationDef.some((name) =>
        name.startsWith("0603_max_rows_and_cols_"),
      )
      const is1206x4Combo = combinationDef.includes("1206x4")

      if (is0603Combo && !this.availableJumperTypes.includes("0603")) continue
      if (is1206x4Combo && !this.availableJumperTypes.includes("1206x4"))
        continue

      const hyperParameterCombinations = this.getHyperParameterCombinations(
        hyperParameterDefs.filter((hpd) => combinationDef.includes(hpd.name)),
      )

      for (const hyperParameters of hyperParameterCombinations) {
        const solver = this.generateSolver(
          hyperParameters as VariantHyperParameters,
        )
        const g = this.computeG(solver)
        this.supervisedSolvers.push({
          hyperParameters,
          solver,
          h: 0,
          g,
          f: g,
        })
      }
    }
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
        JUMPER_TYPE: hyperParameters.JUMPER_TYPE,
        PATTERN: hyperParameters.PATTERN,
        TRACE_CHANNELS_BETWEEN_JUMPERS:
          hyperParameters.TRACE_CHANNELS_BETWEEN_JUMPERS,
      },
      obstacleMargin: this.obstacleMargin,
    })
  }

  computeG(solver: JumperPrepatternSolver2_HyperGraph): number {
    const jumperCount =
      solver.hyperParameters.COLS! * solver.hyperParameters.ROWS!
    // Prefer solutions with fewer iterations, or fewer jumpers
    return solver.iterations / 10000 + jumperCount * 0.25
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
