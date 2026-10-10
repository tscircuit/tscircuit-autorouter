import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { Obstacle } from "../../types/srj-types"
import type {
  Pipeline9NetworkedHighDensityRepairInput,
  Pipeline9NetworkedHighDensityRepairOutput,
} from "./pipeline9NetworkedRepairTypes"

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
  boardGeometry?: HighDensityBoardGeometry
  regionalObstacles: Obstacle[]
  layerCount: number
  nodePf: number | null
  forceImprove?: {
    totalStepsPerNode: number
    nodeAssignmentMargin: number
    preserveTerminalPcbPortIds: boolean
  }
}

export type Pipeline9NetworkedHighDensityNodeOutput =
  | {
      status: "solved"
      solutionStage: "ordinary"
      routes: HighDensityIntraNodeRoute[]
      forceImproved?: true
    }
  | {
      status: "solved"
      solutionStage: "regional-fallback"
      ordinaryFailure: string
      routes: HighDensityIntraNodeRoute[]
      forceImproved?: true
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

export type Pipeline9NetworkedInput =
  | Pipeline9NetworkedHighDensityNodeInput
  | Pipeline9NetworkedHighDensityRepairInput

export type Pipeline9NetworkedOutput =
  | Pipeline9NetworkedHighDensityNodeOutput
  | Pipeline9NetworkedHighDensityRepairOutput

export type Pipeline9NetworkedSolveRequest<
  TInput extends Pipeline9NetworkedInput = Pipeline9NetworkedHighDensityNodeInput,
> = {
  autorouterVersion: string
  /** Optional cache namespace used to isolate benchmark runs. */
  cacheVersion?: string
  input: TInput
}

export type Pipeline9NetworkedSolveBatchItem<
  TInput extends Pipeline9NetworkedInput = Pipeline9NetworkedHighDensityNodeInput,
> = {
  requestId: string
  input: TInput
}

export type Pipeline9NetworkedSolveBatchRequest<
  TInput extends Pipeline9NetworkedInput = Pipeline9NetworkedHighDensityNodeInput,
> = {
  autorouterVersion: string
  /** Optional cache namespace used to isolate benchmark runs. */
  cacheVersion?: string
  items: Pipeline9NetworkedSolveBatchItem<TInput>[]
}

export type Pipeline9NetworkedSolveResponse<
  TOutput extends Pipeline9NetworkedOutput = Pipeline9NetworkedHighDensityNodeOutput,
> =
  | ({
      ok: true
      autorouterVersion: string
      cacheVersion?: string
      source: Pipeline9NetworkedCacheSource
    } & TOutput)
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
export type Pipeline9NetworkedSolveBatchResult<
  TOutput extends Pipeline9NetworkedOutput = Pipeline9NetworkedHighDensityNodeOutput,
> =
  | ({ requestId: string } & Pipeline9NetworkedSolveResponse<TOutput>)
  | Pipeline9NetworkedSolveBatchCacheMiss
