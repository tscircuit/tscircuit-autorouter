import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getMinimumTraceWidthByConnectionName } from "lib/utils/getMinimumTraceWidthByConnectionName"

type Params = ConstructorParameters<typeof TraceSimplificationSolver>[0] & {
  connections?: readonly SimpleRouteConnection[]
}

/**
 * Keep minimum-constrained copper fixed during optional simplification. The
 * native path optimizer uses a hardcoded obstacle margin and cannot preserve
 * this new contract yet. Other routes still simplify around the exact copper.
 */
export class Pipeline9TraceSimplificationSolver extends TraceSimplificationSolver {
  private readonly minimumWidthRoutes: HighDensityRoute[]

  constructor(params: Params) {
    const minimumWidths = getMinimumTraceWidthByConnectionName(params.connections ?? [])
    const minimumWidthRoutes: HighDensityRoute[] = []
    const mutableRoutes: HighDensityRoute[] = []
    for (const route of params.hdRoutes) {
      const constrained = minimumWidths.has(route.connectionName) ||
        (route.rootConnectionName !== undefined && minimumWidths.has(route.rootConnectionName))
      if (constrained) minimumWidthRoutes.push(route)
      else mutableRoutes.push(route)
    }
    super({
      ...params,
      hdRoutes: mutableRoutes,
      otherHdRoutes: [...params.otherHdRoutes ?? [], ...minimumWidthRoutes],
    })
    this.minimumWidthRoutes = minimumWidthRoutes
  }

  override get simplifiedHdRoutes(): HighDensityRoute[] {
    return [
      ...this.minimumWidthRoutes,
      ...super.simplifiedHdRoutes,
    ]
  }
}
