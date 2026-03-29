import type { TraceThicknessConfig } from "../../types/trace-thickness"
import { resolveTraceWidth } from "../../types/trace-thickness"
import {
  effectiveObstacleRadius,
  recommendedGridStep,
  DEFAULT_MIN_CLEARANCE_MM,
} from "../../utils/trace-width"

export interface CapacityMeshSolverOptions {
  /**
   * Trace width configuration.  Accepts:
   *  - A `TraceThicknessConfig` object (`{ widthMultiple: 8 }`)
   *  - A raw mm value (e.g. `1.2`)
   *  - `undefined` / omitted → defaults to 0.15 mm (1×)
   */
  traceThickness?: TraceThicknessConfig | number
  /** Minimum copper-to-copper clearance in mm.  Default: 0.15 mm */
  minClearanceMm?: number
}

/**
 * CapacityMeshSolver — routes using a capacity-mesh grid.
 *
 * When thicker traces are requested the grid cells that are available for
 * routing shrink because the swept area of each segment is larger.  The
 * `obstacleRadius` derived here accounts for that and should be passed into
 * the underlying mesh-capacity calculations.
 */
export class CapacityMeshSolver {
  readonly traceWidthMm: number
  readonly minClearanceMm: number
  readonly obstacleRadius: number
  readonly gridStep: number

  constructor(options: CapacityMeshSolverOptions = {}) {
    this.traceWidthMm = resolveTraceWidth(options.traceThickness)
    this.minClearanceMm = options.minClearanceMm ?? DEFAULT_MIN_CLEARANCE_MM
    this.obstacleRadius = effectiveObstacleRadius(
      this.traceWidthMm,
      this.minClearanceMm,
    )
    this.gridStep = recommendedGridStep(this.traceWidthMm, this.minClearanceMm)
  }

  getRoutingParams() {
    return {
      traceWidthMm: this.traceWidthMm,
      minClearanceMm: this.minClearanceMm,
      obstacleRadius: this.obstacleRadius,
      gridStep: this.gridStep,
    }
  }
}
