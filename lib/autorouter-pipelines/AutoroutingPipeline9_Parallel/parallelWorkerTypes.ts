import type { HighDensityBoardGeometry } from "../../types/high-density-board-geometry"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../../types/high-density-types"
import type { Obstacle } from "../../types/srj-types"
import type { ParallelStageWorkerJob } from "./parallelStageWorkerTypes"
import type { MultiHeadHistoryJob, MultiHeadHistoryRequest } from "./parallelMultiHeadHistoryTypes"

export type Pipeline9ParallelHighDensityContext = {
  connectivityNetMap: Record<string, string[]>
  connectivityIdToNetMap: Record<string, string>
  colorMap: Record<string, string>
  obstacles: Obstacle[]
  boardGeometry?: HighDensityBoardGeometry
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
  layerCount: number
  allowBlindAndBuriedVias: boolean
  viaToPadClearance?: number
  preserveTerminalPcbPortIds: boolean
  includeBoardObstacles: boolean
  enableRegionalFallback: boolean
  maxB01Rips?: number
}

export type Pipeline9ParallelHighDensityNodeJob = {
  kind: "highDensityNode"
  contextId: number
  context: Pipeline9ParallelHighDensityContext
  nodeWithPortPoints: NodeWithPortPoints
  nodePf: number | null
}

export type Pipeline9ParallelHighDensityNodeResult =
  | { status: "solved"; routes: HighDensityIntraNodeRoute[]; nodeStats: Record<string, number> }
  | { status: "failed"; error: string; nodeStats: Record<string, number> }

export type Pipeline9LocalWorkerJob =
  | Pipeline9ParallelHighDensityNodeJob
  | ParallelStageWorkerJob
  | MultiHeadHistoryJob
  | { kind: "warmup" }

export type Pipeline9LocalWorkerRequest = {
  taskId: number
  job: Pipeline9LocalWorkerJob | Omit<Pipeline9ParallelHighDensityNodeJob, "context">
}

export type Pipeline9LocalWorkerResponse =
  | MultiHeadHistoryRequest
  | { taskId: number; ok: true; result: unknown }
  | { taskId: number; ok: false; error: string }
