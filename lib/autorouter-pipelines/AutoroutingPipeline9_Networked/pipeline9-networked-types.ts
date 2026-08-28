import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { Obstacle } from "../../types/srj-types"

export type Pipeline9NetworkedCacheSource = "cache" | "solver"

/**
 * Every solution-affecting input for Pipeline9's ordinary single-node
 * high-density solver. The shape is JSON-serializable so the exact same helper
 * can run in the cache service.
 */
export type Pipeline9NetworkedHighDensityNodeInput = {
  nodeWithPortPoints: NodeWithPortPoints
  connectivityNetMap: Record<string, string[]>
  colorMap: Record<string, string>
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: 1
  obstacles: Obstacle[]
  layerCount: number
  nodePf: number | null
}

export type Pipeline9NetworkedHighDensityNodeOutput =
  | {
      status: "solved"
      routes: HighDensityIntraNodeRoute[]
    }
  | {
      status: "failed"
      error: string
    }

export type Pipeline9NetworkedSolveRequest = {
  autorouterVersion: string
  input: Pipeline9NetworkedHighDensityNodeInput
}

export type Pipeline9NetworkedSolveResponse =
  | ({
      ok: true
      autorouterVersion: string
      source: Pipeline9NetworkedCacheSource
    } & Pipeline9NetworkedHighDensityNodeOutput)
  | {
      ok: false
      autorouterVersion?: string
      message: string
    }
