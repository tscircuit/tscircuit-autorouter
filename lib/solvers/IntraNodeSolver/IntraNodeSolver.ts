import type { TraceThicknessConfig } from "../../types/trace-thickness"
import { resolveTraceWidth } from "../../types/trace-thickness"
import {
  effectiveObstacleRadius,
  recommendedGridStep,
  DEFAULT_MIN_CLEARANCE_MM,
} from "../../utils/trace-width"

export interface IntraNodeSolverOptions {
  /**
   * Trace width configuration.  Accepts:
   *  - A `TraceThicknessConfig` object (`{ widthMultiple: 2 }`)
   *  - A raw mm value (e.g. `0.3`)
   *  - `undefined` / omitted → defaults to 0.15 mm (1×)
   */
  traceThickness?: TraceThicknessConfig | number
  /** Minimum copper-to-copper clearance in mm.  Default: 0.15 mm */
  minClearanceMm?: number
}

/**
 * IntraNodeSolver — routes connections within a single routing node.
 *
 * This stub demonstrates how `traceThickness` is threaded into the solver
 * and used to derive obstacle radii and grid steps that are appropriate for
 * the requested trace width.
 */
export class IntraNodeSolver {
  readonly traceWidthMm: number
  readonly minClearanceMm: number
  readonly obstacleRadius: number
  readonly gridStep: number

  constructor(options: IntraNodeSolverOptions = {}) {
    this.traceWidthMm = resolveTraceWidth(options.traceThickness)
    this.minClearanceMm = options.minClearanceMm ?? DEFAULT_MIN_CLEARANCE_MM
    this.obstacleRadius = effectiveObstacleRadius(
      this.traceWidthMm,
      this.minClearanceMm,
    )
    this.gridStep = recommendedGridStep(this.traceWidthMm, this.minClearanceMm)
  }

  /**
   * Returns the routing parameters derived from the configured trace width.
   * These are consumed by the underlying path-finding algorithm.
   */
  getRoutingParams() {
    return {
      traceWidthMm: this.traceWidthMm,
      minClearanceMm: this.minClearanceMm,
      obstacleRadius: this.obstacleRadius,
      gridStep: this.gridStep,
    }
  }
}
