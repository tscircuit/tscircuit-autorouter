/**
 * Trace-thickness extensions for SimpleRouteJson.
 *
 * The canonical SimpleRouteJson / SimpleRouteConnection types come from
 * srj-types (re-exported via lib/types/index.ts).  Rather than redefining
 * those shapes here — which would create an incompatible duplicate — we only
 * declare the additional, optional thickness fields that this feature adds.
 *
 * Consumers that need the full type can use:
 *   import type { SimpleRouteJson } from "srj-types"
 * and then apply TraceThicknessOptions on top of individual connections.
 */

import type { TraceThicknessMultiplier } from "./TraceThickness";

/**
 * Optional trace-thickness overrides that can be attached to an individual
 * SimpleRouteConnection (or to the top-level SimpleRouteJson as a default).
 *
 * At most one of the two fields should be supplied; if both are present,
 * `traceWidth` takes precedence.
 */
export interface TraceThicknessOptions {
  /** Explicit trace width in mm. Overrides thicknessMultiplier when set. */
  traceWidth?: number;
  /**
   * Thickness expressed as a multiplier of the baseline trace width.
   * @see TraceThicknessMultiplier for valid values.
   */
  thicknessMultiplier?: TraceThicknessMultiplier;
}
