import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { Obstacle } from "../../types/srj-types"

export type Pipeline9NetworkedCacheSource = "cache" | "solver"

export const PIPELINE9_NETWORKED_SOLVE_POLICY =
  "ordinary_then_regional_without_fixed_copper_v1" as const

/**
 * Every solution-affecting input for Pipeline9's terminal single-node policy:
 * ordinary high-density routing followed, when enabled, by the regional
 * no-fixed-copper fallback. The shape is JSON-serializable so the exact same
 * helper can run in the cache service.
 */
export type Pipeline9NetworkedHighDensityNodeInput = {
  solvePolicy: typeof PIPELINE9_NETWORKED_SOLVE_POLICY
  enableRegionalFallback: boolean
  nodeWithPortPoints: NodeWithPortPoints
  connectivityNetMap: Record<string, string[]>
  colorMap: Record<string, string>
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: 1
  obstacles: Obstacle[]
  regionalObstacles: Obstacle[]
  layerCount: number
  nodePf: number | null
}

export type Pipeline9NetworkedHighDensityNodeOutput =
  | {
      status: "solved"
      solutionStage: "ordinary"
      routes: HighDensityIntraNodeRoute[]
    }
  | {
      status: "solved"
      solutionStage: "regional-fallback"
      ordinaryFailure: string
      routes: HighDensityIntraNodeRoute[]
    }
  | {
      status: "failed"
      solutionStage: "ordinary"
      error: string
    }
  | {
      status: "failed"
      solutionStage: "regional-fallback"
      ordinaryFailure: string
      error: string
    }

export type Pipeline9NetworkedSolveRequest = {
  autorouterVersion: string
  /** Optional cache namespace used to isolate benchmark runs. */
  cacheVersion?: string
  input: Pipeline9NetworkedHighDensityNodeInput
}

export type Pipeline9NetworkedSolveBatchItem = {
  requestId: string
  input: Pipeline9NetworkedHighDensityNodeInput
}

export type Pipeline9NetworkedSolveBatchRequest = {
  autorouterVersion: string
  /** Optional cache namespace used to isolate benchmark runs. */
  cacheVersion?: string
  items: Pipeline9NetworkedSolveBatchItem[]
}

export type Pipeline9NetworkedSolveResponse =
  | ({
      ok: true
      autorouterVersion: string
      cacheVersion?: string
      source: Pipeline9NetworkedCacheSource
    } & Pipeline9NetworkedHighDensityNodeOutput)
  | {
      ok: false
      autorouterVersion?: string
      cacheVersion?: string
      message: string
    }

export type Pipeline9NetworkedSolveBatchCacheMiss = {
  requestId: string
  ok: false
  autorouterVersion: string
  cacheVersion?: string
  code: "CACHE_MISS"
  message: string
}

/** One independently consumable NDJSON line returned by POST /solve-batch. */
export type Pipeline9NetworkedSolveBatchResult =
  | ({ requestId: string } & Pipeline9NetworkedSolveResponse)
  | Pipeline9NetworkedSolveBatchCacheMiss
