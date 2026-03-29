/**
 * Extended SimpleRouteJson types that add trace-width / thickness-multiplier
 * support on top of the base srj-types definitions.
 *
 * These types are intentionally named with an "Extended" prefix so they do NOT
 * conflict with the canonical `SimpleRouteJson` / `SimpleRouteConnection`
 * definitions that live in `srj-types`.
 */

import type {
  SimpleRouteJson as BaseSimpleRouteJson,
  SimpleRouteConnection as BaseSimpleRouteConnection,
} from "srj-types";

/**
 * A `SimpleRouteConnection` augmented with optional per-connection trace
 * width/thickness overrides.
 */
export interface ExtendedSimpleRouteConnection extends BaseSimpleRouteConnection {
  /** Explicit trace width in mm. Takes precedence over `thicknessMultiplier`. */
  traceWidth?: number;
  /**
   * Thickness multiplier relative to the board's default trace width.
   * e.g. 1.0 = default, 2.0 = double width.
   */
  thicknessMultiplier?: number;
}

/**
 * A `SimpleRouteJson` augmented with optional board-level trace width defaults
 * and per-connection overrides via `ExtendedSimpleRouteConnection`.
 */
export interface ExtendedSimpleRouteJson
  extends Omit<BaseSimpleRouteJson, "connections"> {
  /** Board-level default trace width in mm. */
  defaultTraceWidth?: number;
  /**
   * Board-level default thickness multiplier.
   * Applied when a connection has no explicit `traceWidth`.
   */
  defaultThicknessMultiplier?: number;
  connections: ExtendedSimpleRouteConnection[];
}
