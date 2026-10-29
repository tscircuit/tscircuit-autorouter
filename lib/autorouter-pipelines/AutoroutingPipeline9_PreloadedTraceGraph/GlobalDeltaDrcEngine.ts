import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import type { SimplifiedPcbTraces } from "high-density-repair03/lib/types"
import { DeltaAutoroutingDrcEngine, type DeltaDrcStats } from "./DeltaAutoroutingDrcEngine"

export type GlobalDeltaDrcStats = DeltaDrcStats & {
  experimentDeltaDrc: true
  stage: "globalDrcForceImproveSolver"
  globalDeltaDrcActivated: boolean
  nativeConstructorCount: number
  deltaDrcChangedCandidateCalls: number
  deltaDrcChangedCandidateReusedQueries: number
}

/** Keeps the native engine API and snapshot policy while replacing its dynamic evaluations. */
export class GlobalDeltaDrcEngine extends AutoroutingDrcEngine {
  readonly globalStats: GlobalDeltaDrcStats
  private readonly delta: DeltaAutoroutingDrcEngine

  constructor(
    srj: ConstructorParameters<typeof AutoroutingDrcEngine>[0],
    options: ConstructorParameters<typeof AutoroutingDrcEngine>[1] = {},
  ) {
    // Retain the real native constructor and its source-bound static setup.
    // Passing this subclass keeps GlobalDrcForceImproveSolver on its original
    // engine/snapshot projection path instead of the external-evaluator path.
    super(srj, options)
    this.delta = new DeltaAutoroutingDrcEngine(srj, options)
    this.globalStats = {
      experimentDeltaDrc: true,
      stage: "globalDrcForceImproveSolver",
      globalDeltaDrcActivated: false,
      nativeConstructorCount: 1,
      deltaDrcChangedCandidateCalls: 0,
      deltaDrcChangedCandidateReusedQueries: 0,
      ...this.delta.deltaStats,
    }
  }

  override evaluate(traces: SimplifiedPcbTraces): ReturnType<AutoroutingDrcEngine["evaluate"]> {
    const before = { ...this.delta.deltaStats }
    const result = this.delta.evaluate(traces)
    this.lastRunStats = this.delta.lastRunStats
    this.updateGlobalStats(before)
    return result
  }

  override evaluateLegacy(traces: SimplifiedPcbTraces): ReturnType<AutoroutingDrcEngine["evaluateLegacy"]> {
    const before = { ...this.delta.deltaStats }
    const result = this.delta.evaluateLegacy(traces)
    this.lastRunStats = this.delta.lastRunStats
    this.updateGlobalStats(before)
    return result
  }

  private updateGlobalStats(before: DeltaDrcStats): void {
    const after = this.delta.deltaStats
    // Initial construction and repeated identical candidates cannot establish
    // that unchanged query ledgers survived a changed dynamic index overlay.
    if (before.deltaDrcCalls > 0 && (
      after.deltaDrcInsertedPrimitives > before.deltaDrcInsertedPrimitives ||
      after.deltaDrcRemovedPrimitives > before.deltaDrcRemovedPrimitives
    )) {
      this.globalStats.deltaDrcChangedCandidateCalls++
      this.globalStats.deltaDrcChangedCandidateReusedQueries +=
        after.deltaDrcReusedQueries - before.deltaDrcReusedQueries
    }
    Object.assign(this.globalStats, after, { globalDeltaDrcActivated: true })
  }
}
