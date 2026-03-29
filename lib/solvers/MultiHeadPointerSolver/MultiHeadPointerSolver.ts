import type { TraceThicknessConfig } from "../../types/trace-thickness"
import { resolveTraceWidth } from "../../types/trace-thickness"
import {
  effectiveObstacleRadius,
  recommendedGridStep,
  DEFAULT_MIN_CLEARANCE_MM,
} from "../../utils/trace-width"

export interface MultiHeadPointerSolverOptions {
  /**
   * Trace width configuration.  Accepts:
   *  - A `TraceThicknessConfig` object (`{ widthMultiple: 4 }`)
   *  - A raw mm value (e.g. `0.6`)
   *  - `undefined` / omitted → defaults to 0.15 mm (1×)
   */
  traceThickness?: TraceThicknessConfig | number
  /** Minimum copper-to-copper clearance in mm.  Default: 0.15 mm */
  minClearanceMm?: number
}

/**
 * MultiHeadPointerSolver — routes multiple trace heads simultaneously.
 *
 * Trace-width awareness is critical here: thicker traces occupy more board
 * area, so the collision / probability calculations must use the correct
 * obstacle radius derived from the actual trace width.
 */
export class MultiHeadPointerSolver {
  readonly traceWidthMm: number
  readonly minClearanceMm: number
  readonly obstacleRadius: number
  readonly gridStep: number

  constructor(options: MultiHeadPointerSolverOptions = {}) {
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
