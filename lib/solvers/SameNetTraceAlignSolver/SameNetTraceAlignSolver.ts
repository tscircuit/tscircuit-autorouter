import { HighDensityRoute } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"
import { Obstacle } from "lib/types"

/**
 * Traces on the same net should run in parallel and touching eachother.
 *
 * This gives the appearance that traces coming from the same pad have a
 * "mega trace".
 */
export class SameNetTraceAlignSolver extends BaseSolver {
  constructor({
    unalignedHdRoutes,
    obstacles,
  }: { unalignedHdRoutes: HighDensityRoute; obstacles: Obstacle[] }) {
    super()
  }
}
