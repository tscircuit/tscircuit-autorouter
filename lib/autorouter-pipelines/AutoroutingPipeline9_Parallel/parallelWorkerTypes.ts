import type { HighDensityBoardGeometry } from "../../types/high-density-board-geometry"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../../types/high-density-types"
import type { Obstacle } from "../../types/srj-types"
import type { ParallelStageWorkerJob } from "./parallelStageWorkerTypes"
import type { MultiHeadHistoryCancellation, MultiHeadHistoryJob, MultiHeadHistoryRequest } from "./parallelMultiHeadHistoryTypes"
import type { FirstValidHighDensityStats, ParallelHighDensityPolicy } from "./parallelHighDensityPolicyTypes"
import type { FirstValidA13CandidateCancellation, FirstValidA13CandidateJob, FirstValidA13CandidateRequest } from "./firstValidA13CandidateTypes"
import type { FirstValidA13NodeJob } from "./parallelHighDensityFrontierTypes"
import type { ParallelHighDensityNodeBatchJob } from "./parallelHighDensityNodeBatching"

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
  highDensityPolicy?: ParallelHighDensityPolicy
  firstValidClearance?: number
  requirePhysicalCopper?: boolean
}

export type Pipeline9ParallelHighDensityNodeJob = {
  kind: "highDensityNode"
  contextId: number
  context: Pipeline9ParallelHighDensityContext
  nodeWithPortPoints: NodeWithPortPoints
  nodePf: number | null
  cancellationBuffer?: SharedArrayBuffer
  disableIdleA13Candidate?: boolean
}

export type Pipeline9ParallelHighDensityNodeResult =
  | { status: "solved"; routes: HighDensityIntraNodeRoute[]; nodeStats: Record<string, number>; firstValidStats?: FirstValidHighDensityStats; nodeIterations?: number; nodeMaximumIterations?: number }
  | { status: "failed"; error: string; nodeStats: Record<string, number>; firstValidStats?: FirstValidHighDensityStats; nodeIterations?: number; nodeMaximumIterations?: number }
  | { status: "cancelled"; nodeStats: Record<string, number>; firstValidStats?: FirstValidHighDensityStats; nodeIterations?: number; nodeMaximumIterations?: number }
  | { status: "exception"; exception: { name: string; message: string; stack?: string }; nodeStats: Record<string, number>; firstValidStats?: FirstValidHighDensityStats; nodeIterations?: number; nodeMaximumIterations?: number }

export type Pipeline9LocalWorkerJob =
  | Pipeline9ParallelHighDensityNodeJob
  | ParallelHighDensityNodeBatchJob
  | ParallelStageWorkerJob
  | MultiHeadHistoryJob
  | FirstValidA13CandidateJob
  | FirstValidA13NodeJob
  | { kind: "warmup" }

export type Pipeline9LocalWorkerRequest = {
  taskId: number
  job: Pipeline9LocalWorkerJob | Omit<Pipeline9ParallelHighDensityNodeJob, "context"> |
    Omit<FirstValidA13NodeJob, "context"> | Omit<ParallelHighDensityNodeBatchJob, "context">
}

export type Pipeline9LocalWorkerResponse =
  | MultiHeadHistoryRequest
  | MultiHeadHistoryCancellation
  | FirstValidA13CandidateRequest
  | FirstValidA13CandidateCancellation
  | { taskId: number; ok: true; result: unknown }
  | { taskId: number; ok: false; error: string }
