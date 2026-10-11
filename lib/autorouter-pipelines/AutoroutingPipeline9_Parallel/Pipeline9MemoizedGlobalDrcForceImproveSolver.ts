import { AutoroutingDrcEngine, GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import { RELAXED_DRC_OPTIONS } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/drcPresets"
import { Pipeline9MemoizedAutoroutingDrcEngine } from "./repair03/Pipeline9MemoizedAutoroutingDrcEngine"

type Params = ConstructorParameters<typeof GlobalDrcForceImproveSolver>[0]

/** Original force-improve policy with persistent exact clear-geometry checks. */
export class Pipeline9MemoizedGlobalDrcForceImproveSolver extends GlobalDrcForceImproveSolver {
  constructor(params: Params) {
    const engine = params.autoroutingDrcEngine ?? (params.drcEvaluator ? undefined :
      new Pipeline9MemoizedAutoroutingDrcEngine(params.srj, {
        connMap: params.connMap,
        traceClearance: params.srj.minTraceToPadEdgeClearance ?? RELAXED_DRC_OPTIONS.traceClearance,
        viaClearance: params.srj.minTraceToPadEdgeClearance ?? RELAXED_DRC_OPTIONS.viaClearance,
        includeTraceViaOwnerMetadata: params.enableTraceViaOwnerTargeting ?? false,
      }))
    // The pinned helpers use only evaluate/evaluateLegacy/lastRunStats. The
    // dependency's private members make this otherwise matching API nominal.
    super({ ...params, autoroutingDrcEngine: engine as AutoroutingDrcEngine | undefined })
  }

  override getSolverName(): string {
    // This opt-in storage optimization still implements the existing solver.
    // Preserve its phase labels and named invariant/iteration errors so callers
    // see the same public diagnostics as the pinned implementation.
    return GlobalDrcForceImproveSolver.name
  }
}
