import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import type { DrcEvaluator } from "high-density-repair03/lib"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { visualizeHighDensityRoutes } from "lib/utils/visualizeHighDensityRoutes"
import { BaseSolver } from "../BaseSolver"
import { applyClearanceProjection } from "./applyClearanceProjection"
import { createsTraceCrossing } from "./createsTraceCrossing"

export type ClearanceProjectionSolverParams = {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  fixedObstacleRoutes: HighDensityRoute[]
  drcEvaluator: DrcEvaluator
  connMap?: ConnectivityMap
  colorMap: Record<string, string>
}

/** One coupled projection after exact repair, accepted against the reference DRC. */
export class ClearanceProjectionSolver extends BaseSolver {
  readonly params: ClearanceProjectionSolverParams
  private routes: HighDensityRoute[]

  constructor(params: ClearanceProjectionSolverParams) {
    super()
    this.params = params
    this.routes = params.routes
  }

  override getConstructorParams(): [ClearanceProjectionSolverParams] {
    return [this.params]
  }

  override _step(): void {
    const counts: number[] = []
    const start = performance.now()
    const candidate = applyClearanceProjection({
      ...this.params,
      drcEvaluator: (input): ReturnType<DrcEvaluator> => {
        const result = this.params.drcEvaluator(input)
        counts.push(
          Array.isArray(result) ? result.length : result.errors.length,
        )
        return result
      },
    })
    const newCrossing =
      candidate !== this.params.routes &&
      createsTraceCrossing(
        [...this.params.routes, ...this.params.fixedObstacleRoutes],
        [...candidate, ...this.params.fixedObstacleRoutes],
        this.params.connMap,
      )
    this.routes = newCrossing ? this.params.routes : candidate
    this.stats = {
      initialDrcIssueCount: counts[0],
      finalDrcIssueCount:
        this.routes === this.params.routes ? counts[0] : counts.at(-1),
      clearanceProjectionAccepted: this.routes !== this.params.routes,
      clearanceProjectionRejectedCrossing: newCrossing,
      clearanceProjectionTimeMs: performance.now() - start,
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
      "Coupled clearance projection",
    )
  }
}
