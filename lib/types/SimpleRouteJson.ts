import type { TraceThicknessMultiplier } from "./TraceThickness"

export interface Point {
  x: number
  y: number
}

export interface Obstacle {
  type: "rect" | "circle"
  center: Point
  width?: number
  height?: number
  radius?: number
  /** Net name this obstacle belongs to (used for same-net clearance skipping) */
  connectedTo: string[]
  layers: string[]
}

/**
 * A single connection (net segment) that the autorouter must route.
 *
 * `traceWidth` – explicit trace width in mm.  When omitted the autorouter
 * uses the default width derived from `thicknessMultiplier`.
 *
 * `thicknessMultiplier` – convenience shorthand; one of 1×, 2×, 4×, 8×
 * relative to the 0.15 mm base width.  Ignored when `traceWidth` is set.
 * Defaults to 1 (0.15 mm).
 */
export interface SimpleRouteConnection {
  name: string
  pointsToConnect: Point[]
  /** Layer(s) the trace is allowed to use */
  allowedLayers?: string[]
  /**
   * Explicit trace width in millimetres.
   * Overrides `thicknessMultiplier` when both are supplied.
   */
  traceWidth?: number
  /**
   * Thickness as a multiplier of the 0.15 mm base width (1 | 2 | 4 | 8).
   * Defaults to 1 (standard signal-line width).
   */
  thicknessMultiplier?: TraceThicknessMultiplier
}

export interface SimpleRouteJson {
  minTraceWidth: number
  /** Board / routing-area bounds */
  bounds?: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  }
  connections: SimpleRouteConnection[]
  obstacles: Obstacle[]
  layers: string[]
}
