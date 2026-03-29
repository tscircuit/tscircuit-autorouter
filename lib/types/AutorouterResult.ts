import type { TraceThicknessOptions } from "./SimpleRouteJson";

/**
 * A single routed segment produced by the autorouter.
 */
export interface RoutedSegment {
  /** Net / connection name this segment belongs to. */
  connectionName: string;
  /** X coordinate of the segment start (mm). */
  x1: number;
  /** Y coordinate of the segment start (mm). */
  y1: number;
  /** X coordinate of the segment end (mm). */
  x2: number;
  /** Y coordinate of the segment end (mm). */
  y2: number;
  /** Layer the segment lives on (e.g. "top", "bottom", "inner1"). */
  layer: string;
  /** Resolved trace width in mm for this specific segment. */
  width: number;
}

/**
 * The result returned by the autorouter after completing a routing pass.
 */
export interface AutorouterResult {
  /** All routed wire segments, each carrying an explicit resolved width. */
  segments: RoutedSegment[];
  /**
   * Thickness options that were applied as the global default for this run.
   * Individual segments may have been routed with different widths if their
   * connection specified per-connection overrides.
   */
  defaultThickness?: TraceThicknessOptions;
}
