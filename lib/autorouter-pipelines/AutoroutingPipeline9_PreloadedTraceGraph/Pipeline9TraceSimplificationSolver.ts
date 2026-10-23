import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { normalizeCoincidentRoutePoints } from "./normalizeCoincidentRoutePoints"

type Options = ConstructorParameters<typeof TraceSimplificationSolver>[0]
type ExtractResult = NonNullable<TraceSimplificationSolver["extractResult"]>

/** Preserve outgoing edge provenance at every simplification phase boundary. */
export class Pipeline9TraceSimplificationSolver extends TraceSimplificationSolver {
  private normalizedExtractor: ExtractResult | null = null

  constructor(options: Options) {
    super({
      ...options,
      hdRoutes: options.hdRoutes.map(normalizeCoincidentRoutePoints),
      otherHdRoutes: options.otherHdRoutes?.map(normalizeCoincidentRoutePoints),
    })
    this.hdRoutes = this.hdRoutes.map(normalizeCoincidentRoutePoints)
  }

  override _step(): void {
    super._step()
    // The base installs a fresh extractor when it creates each sub-solver,
    // before that sub-solver takes any steps. Normalize its result before the
    // next solver's constructor consumes it; never catch solver invariants.
    if (this.extractResult && this.extractResult !== this.normalizedExtractor) {
      const extract = this.extractResult
      this.normalizedExtractor = (solver) => extract(solver).map(normalizeCoincidentRoutePoints)
      this.extractResult = this.normalizedExtractor
    }
  }
}
