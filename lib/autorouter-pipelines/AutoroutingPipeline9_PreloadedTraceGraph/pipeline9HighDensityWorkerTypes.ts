import type { Pipeline9HighDensitySolverParams } from "./Pipeline9HighDensitySolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../../types/high-density-types"

export type Pipeline9SolveAsyncOptions = {
  /** Maximum concurrent workers. Defaults to at most eight, leaving CPU headroom. */
  workerCount?: number
}

export type HighDensityWorkerShared = Omit<Pipeline9HighDensitySolverParams, "connMap" | "nodePortPoints"> & {
  connectivityNetMap: Record<string, string[]>
}

export type HighDensityWorkerRequest =
  | { type: "init"; shared: HighDensityWorkerShared }
  | { type: "solve"; index: number; nodes: NodeWithPortPoints[]; maxIterations: number }

export type HighDensityWorkerResult = {
  index: number
  routes: HighDensityIntraNodeRoute[]
  stats: Record<string, number>
  iterations: number
  consumedNodeCount: number
  solved: boolean
  error: string | null
}

export type HighDensityWorkerResponse =
  | { type: "result"; result: HighDensityWorkerResult }
  | { type: "error"; message: string; stack?: string }
