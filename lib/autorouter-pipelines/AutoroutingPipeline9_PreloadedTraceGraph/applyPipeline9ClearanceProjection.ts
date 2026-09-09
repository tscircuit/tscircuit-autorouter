import type { DrcEvaluator } from "high-density-repair03/lib"
import { applyClearanceProjection } from "lib/solvers/ClearanceProjectionSolver/applyClearanceProjection"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

export const applyPipeline9ClearanceProjection = (params: {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  syntheticConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
}): HighDensityRoute[] => {
  if (
    params.originalSrj.traces?.length ||
    params.syntheticConnectionNames.size > 0
  ) {
    return params.routes
  }
  return applyClearanceProjection({ ...params, fixedObstacleRoutes: [] })
}
