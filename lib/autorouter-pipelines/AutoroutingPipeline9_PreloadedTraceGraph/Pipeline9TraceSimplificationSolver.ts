import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { materializePipeline9HdRouteVias } from "./materializePipeline9HdRouteVias"

/** Keep each simplification phase's explicit via ownership consumable downstream. */
export class Pipeline9TraceSimplificationSolver extends TraceSimplificationSolver {
  override markThroughObstacleSegments(
    routes: readonly HighDensityRoute[],
  ): HighDensityRoute[] {
    // Path simplification can combine a wire and its terminal via into one
    // diagonal Z-changing segment. Preserve the original physical endpoint;
    // the following strict via merger requires a colocated transition pair.
    // Use only exact registered transition sites from the accepted prior phase
    // if cleanup omitted its via list. Pad barrels keep their original marker.
    const canonical = materializePipeline9HdRouteVias(routes, this.hdRoutes)
    return materializePipeline9HdRouteVias(
      super.markThroughObstacleSegments(canonical),
    )
  }
}
