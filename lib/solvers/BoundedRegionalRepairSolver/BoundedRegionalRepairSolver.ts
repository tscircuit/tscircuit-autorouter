import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { visualizeHighDensityRoutes } from "lib/utils/visualizeHighDensityRoutes"
import { BaseSolver } from "../BaseSolver"
import {
  applyBoundedRegionalRepairs,
  type BoundedRegionalRepairParams,
} from "./applyBoundedRegionalRepairs"

export type BoundedRegionalRepairSolverParams = BoundedRegionalRepairParams & {
  colorMap: Record<string, string>
}

/** One negotiated repair pass under a shared search budget. */
export class BoundedRegionalRepairSolver extends BaseSolver {
  readonly params: BoundedRegionalRepairSolverParams
  private routes: HighDensityRoute[]

  constructor(params: BoundedRegionalRepairSolverParams) {
    super()
    this.params = params
    this.routes = params.routes
  }

  override getConstructorParams(): [BoundedRegionalRepairSolverParams] {
    return [this.params]
  }

  override _step(): void {
    const start = performance.now()
    const { routes, ...result } = applyBoundedRegionalRepairs(this.params)
    this.routes = routes
    this.stats = {
      ...result,
      boundedRegionalRepairTimeMs: performance.now() - start,
    }
    this.solved = true
  }

  getOutput(): HighDensityRoute[] {
    return this.routes
  }

  override visualize(): GraphicsObject {
    return visualizeHighDensityRoutes(
      this.routes,
      this.params.colorMap,
      "Bounded regional repair",
    )
  }
}
