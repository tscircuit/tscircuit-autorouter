import { AutoroutingDrcEngine, type SimpleRouteJson, type SimplifiedPcbTraces } from "high-density-repair03/lib"
import { getDrcSnapshot } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { HighDensityRoute } from "high-density-repair03/lib/types/high-density-types"
import { Pipeline9MemoizedAutoroutingDrcEngine } from "./repair03/Pipeline9MemoizedAutoroutingDrcEngine"
import { restoreWorkerConnectivityMap } from "./restoreWorkerConnectivityMap"

export type Pipeline9NativeGlobalDrcContext = {
  srj: SimpleRouteJson
  engineOptions: Omit<NonNullable<ConstructorParameters<typeof AutoroutingDrcEngine>[1]>, "connMap">
  connectivity?: { connectivityNetMap: Record<string, string[]>; connectivityIdToNetMap: Record<string, string> }
}

export type Pipeline9PreparedNativeGlobalDrcEvaluation = {
  candidateKey: string
  evaluatedTraceKey: string
  evaluatedDrc: ReturnType<Pipeline9MemoizedAutoroutingDrcEngine["evaluate"]>
  lastRunStats: Pipeline9MemoizedAutoroutingDrcEngine["lastRunStats"]
}

export type Pipeline9NativeGlobalDrcExceptionEvaluation = {
  evaluatedTraceKey?: string
  lastRunStats: Pipeline9MemoizedAutoroutingDrcEngine["lastRunStats"]
}

export type Pipeline9PreparedNativeGlobalDrcEvaluator = {
  evaluate(routes: HighDensityRoute[]): Pipeline9PreparedNativeGlobalDrcEvaluation
  getExceptionEvaluation(): Pipeline9NativeGlobalDrcExceptionEvaluation
}

/** Use the pinned standalone converter; Joint's preload/ID converter is distinct. */
export function createPreparedNativeGlobalDrcEvaluation(
  context: Pipeline9NativeGlobalDrcContext,
): Pipeline9PreparedNativeGlobalDrcEvaluator {
  const connMap = context.connectivity ? restoreWorkerConnectivityMap(context.connectivity) : undefined
  const engine = new Pipeline9MemoizedAutoroutingDrcEngine(context.srj, { ...context.engineOptions, connMap })
  let evaluatedTraceKey: string | undefined
  let evaluatedDrc: Pipeline9PreparedNativeGlobalDrcEvaluation["evaluatedDrc"] | undefined
  const capturingEngine = {
    evaluate(traces: SimplifiedPcbTraces): Pipeline9PreparedNativeGlobalDrcEvaluation["evaluatedDrc"] {
      evaluatedTraceKey = JSON.stringify(traces)
      evaluatedDrc = engine.evaluate(traces)
      return evaluatedDrc
    },
  } as unknown as AutoroutingDrcEngine
  return {
    evaluate(routes: HighDensityRoute[]): Pipeline9PreparedNativeGlobalDrcEvaluation {
      evaluatedTraceKey = undefined
      evaluatedDrc = undefined
      getDrcSnapshot(context.srj, routes, undefined, connMap, capturingEngine)
      if (evaluatedTraceKey === undefined || evaluatedDrc === undefined) {
        throw new Error("Native parallel DRC did not evaluate its original simplified trace input")
      }
      return { candidateKey: JSON.stringify(routes), evaluatedTraceKey, evaluatedDrc,
        lastRunStats: { ...engine.lastRunStats } }
    },
    getExceptionEvaluation(): Pipeline9NativeGlobalDrcExceptionEvaluation {
      // Preparation may throw before evaluate is entered. An absent key keeps
      // that distinction; the parent still enters its original getSnapshot.
      const lastRunStats = { ...engine.lastRunStats }
      return { evaluatedTraceKey, lastRunStats }
    },
  }
}
