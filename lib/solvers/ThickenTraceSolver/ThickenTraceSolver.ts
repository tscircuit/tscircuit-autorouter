import { HighDensityRoute } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { Obstacle, SimpleRouteJson } from "lib/types"

/**
 * The thicken trace solver increases the thickness of traces for segments where
 * it's possible to thicken the trace.
 *
 * The algorithm can work using the following mechanism:
 * 1. Iterate over each trace
 * 2. Maximimally thicken
 */
export class ThickenTraceSolver extends BaseSolver {
  constructor({
    originalHdRoutes,
    obstacles,
  }: {
    originalHdRoutes: HighDensityRoute
    // Contains connection thickness and obstacle information
    srj: SimpleRouteJson
  }) {
    super()
  }
}
