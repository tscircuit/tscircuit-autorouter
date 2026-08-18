import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { Obstacle } from "../../types/srj-types"

/**
 * Immutable inputs shared by every high-density node solve. This shape is
 * deliberately free of class instances and functions so it can be sent to a
 * Web Worker once when an executor session is created.
 */
export interface HighDensitySolverExecutionContext {
  colorMap: Record<string, string>
  connectivityNetMap?: Record<string, string[]>
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
  obstacles: Obstacle[]
  layerCount: number
  useGrowShrinkHighDensityIntraNodeSolver: boolean
  preserveTerminalPcbPortIds: boolean
  growShrinkMaxInnerIterationsPerGrowthAttempt?: number
  growShrinkFallbackToInvalidGeometryOnFailure: boolean
  captureSearchDebug: boolean
}

/** One independent capacity-mesh node sent across the executor boundary. */
export interface HighDensityNodeSolveTask {
  nodeIndex: number
  nodeWithPortPoints: NodeWithPortPoints
  nodePf: number | null
}

/** Serializable data returned by an executor after solving one node. */
export interface HighDensityNodeSolveResult {
  nodeIndex: number
  status: "solved" | "failed"
  routes: HighDensityIntraNodeRoute[]
  solverType: string
  iterations: number
  routeCount: number
  growthAttempts: number
  cacheHits: number
  cacheMisses: number
  error?: string
}

export interface HighDensitySolverExecutorSession {
  execute(task: HighDensityNodeSolveTask): Promise<HighDensityNodeSolveResult>
  dispose(): void | Promise<void>
}

/**
 * Runtime-owned execution boundary. Implementations may use browser Workers,
 * worker_threads, remote services, or an in-process test double.
 */
export interface HighDensitySolverExecutor {
  createSession(
    context: HighDensitySolverExecutionContext,
    options: { parallelism: number },
  ): HighDensitySolverExecutorSession
}
