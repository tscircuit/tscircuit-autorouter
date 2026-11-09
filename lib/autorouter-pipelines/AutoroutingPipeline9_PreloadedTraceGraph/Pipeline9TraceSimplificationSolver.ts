import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"

type Params = ConstructorParameters<typeof TraceSimplificationSolver>[0]

export class Pipeline9TraceSimplificationSolver extends TraceSimplificationSolver {
  private readonly preservedRoutes: HighDensityRoute[]

  constructor(params: Params) {
    super({
      ...params,
      hdRoutes: [],
      otherHdRoutes: [...(params.otherHdRoutes ?? []), ...params.hdRoutes],
    })
    this.preservedRoutes = [...params.hdRoutes]
  }

  override get simplifiedHdRoutes(): HighDensityRoute[] {
    return [...this.preservedRoutes, ...super.simplifiedHdRoutes]
  }
}
