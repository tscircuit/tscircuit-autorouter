/**
 * Result shape returned by the autorouter, including per-segment trace widths.
 */

export interface RouteSegment {
  /** Start x coordinate in mm */
  x1: number;
  /** Start y coordinate in mm */
  y1: number;
  /** End x coordinate in mm */
  x2: number;
  /** End y coordinate in mm */
  y2: number;
  /** PCB layer identifier (e.g. "top", "bottom") */
  layer: string;
  /** Resolved trace width for this segment in mm */
  width: number;
}

export interface AutorouterResult {
  /** Whether all connections were successfully routed */
  succeeded: boolean;
  /** Per-connection routed segments */
  routes: Array<{
    connectionName: string;
    segments: RouteSegment[];
  }>;
  /** Diagnostic messages, warnings, or errors from the routing run */
  messages?: string[];
}
