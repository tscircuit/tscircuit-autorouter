import type { DatasetSample, HdRoute as RepairHdRoute } from "high-density-repair02"
import type { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute, NodeWithPortPoints } from "../../types/high-density-types"
import type { Pipeline9RegionalB01CandidateParams } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import type { Pipeline9RegionalFallbackSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { TinyLandmarkGraph, TinyLandmarkDistances } from "./TinyLandmarkHeuristic"
import type { NegotiatedPathingRouteJob, NegotiatedPathingRouteResult } from "./parallelNegotiatedPathingTypes"
import type { ParallelGoalBallWorkerJob, ParallelGoalBallWorkerResult } from "./parallelGoalBallWorkerTypes"

export type ParallelRegionalFallbackResult = {
  kind: "regionalFallbackSolve"
  status: "prepared" | "skipped"
  routes?: HighDensityRoute[]
  solved: boolean
  failed: boolean
  childStepBudget: number
} | {
  kind: "regionalFallbackSolve"
  status: "error"
  error: string
}

export type ParallelRegionalB01CandidateResult = {
  kind: "regionalB01Candidate"
  status: "prepared" | "skipped"
  replacement?: HighDensityRoute
  usedFallback: boolean
  childStepBudget: number
} | {
  kind: "regionalB01Candidate"
  status: "error"
  error: string
}

export type ParallelForceImproveNodeJob = {
  kind: "forceImproveNode"
  nodeWithPortPoints: NodeWithPortPoints
  hdRoutes: HighDensityRoute[]
  totalStepsPerNode: number
  nodeAssignmentMargin: number
}

export type ParallelRepairNodeJob = {
  kind: "repairNode"
  sample: DatasetSample
  margin: number
}

export type ParallelForceImproveNodeResult = { kind: "forceImproveNode"; routes: HighDensityRoute[] }
export type ParallelRepairNodeResult = {
  kind: "repairNode"
  repairedRoutes: RepairHdRoute[]
  stats: Record<string, unknown>
}
export type ParallelNodeJob = ParallelForceImproveNodeJob | ParallelRepairNodeJob
export type ParallelNodeResult = ParallelForceImproveNodeResult | ParallelRepairNodeResult
export type ParallelIndexedNodeJob<TJob extends ParallelNodeJob = ParallelNodeJob> = {
  entryIndex: number
  job: TJob
}
export type ParallelIndexedNodeResult<TResult extends ParallelNodeResult = ParallelNodeResult> = {
  entryIndex: number
  result: TResult
}
export type ParallelNodeBatchJob = {
  kind: "forceImproveNodeBatch"
  jobs: ParallelIndexedNodeJob<ParallelForceImproveNodeJob>[]
} | {
  kind: "repairNodeBatch"
  jobs: ParallelIndexedNodeJob<ParallelRepairNodeJob>[]
}
export type ParallelNodeBatchResult = {
  kind: "forceImproveNodeBatch"
  results: ParallelIndexedNodeResult<ParallelForceImproveNodeResult>[]
} | {
  kind: "repairNodeBatch"
  results: ParallelIndexedNodeResult<ParallelRepairNodeResult>[]
}

export type ParallelStageWorkerJob =
  | ParallelGoalBallWorkerJob
  | NegotiatedPathingRouteJob
  | ParallelNodeJob
  | ParallelNodeBatchJob
  | { kind: "pathingLandmark"; graph: TinyLandmarkGraph; landmarkPortId: number }
  | {
      kind: "regionalFallbackSolve"
      params: Omit<ConstructorParameters<typeof Pipeline9RegionalFallbackSolver>[0], "connMap">
      connectivityNetMap: Record<string, string[]>
      connectivityIdToNetMap: Record<string, string>
    }
  | {
      kind: "regionalB01Candidate"
      params: Omit<Pipeline9RegionalB01CandidateParams, "connMap">
      connectivityNetMap: Record<string, string[]>
      connectivityIdToNetMap: Record<string, string>
    }
  | {
      kind: "simplifyPathComponent"
      params: Omit<ConstructorParameters<typeof MultiSimplifiedPathSolver>[0], "connMap"> & {
        preserveLeadingLayerTransitions?: boolean
      }
      connectivityNetMap: Record<string, string[]>
      connectivityIdToNetMap: Record<string, string>
    }

export type ParallelStageWorkerResult =
  | ParallelGoalBallWorkerResult
  | NegotiatedPathingRouteResult
  | ({ kind: "pathingLandmark" } & TinyLandmarkDistances)
  | ParallelRegionalFallbackResult
  | ParallelRegionalB01CandidateResult
  | ParallelNodeResult
  | ParallelNodeBatchResult
  | { kind: "simplifyPathComponent"; routes: HighDensityRoute[] }

export type ParallelStageWorkerPool = {
  /** Custom executors can omit the batching hint; planning then uses four slots. */
  readonly workerCount?: number
  run<T>(job: ParallelStageWorkerJob): Promise<T>
}
