import type { TinyHyperGraphProblem, TinyHyperGraphSolverOptions, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { TinyBitsetCongestionAwareFinalRouteSolver } from "./TinyBitsetCongestionAwareFinalRouteSolver"

/** Cache region costs without changing the native completion routing policy. */
export class TinyCachedCostCongestionAwareFinalRouteSolver extends TinyBitsetCongestionAwareFinalRouteSolver {
  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions) {
    super(topology, problem, options, {
      minimumBitsetSegmentCount: 8,
      enableRegionCostCache: true,
      enableStaticAnglePrefixes: true,
    })
  }
}
