import type { DatasetSample, HdRoute as RepairHdRoute } from "high-density-repair02"
import type { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute, NodeWithPortPoints } from "../../types/high-density-types"
import type { Pipeline9RegionalB01CandidateParams } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import type { Pipeline9RegionalFallbackSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { TinyLandmarkGraph, TinyLandmarkDistances } from "./TinyLandmarkHeuristic"
import type { NegotiatedPathingRouteJob, NegotiatedPathingRouteResult } from "./parallelNegotiatedPathingTypes"

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

export type ParallelStageWorkerJob =
  | NegotiatedPathingRouteJob
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
      kind: "forceImproveNode"
      nodeWithPortPoints: NodeWithPortPoints
      hdRoutes: HighDensityRoute[]
      totalStepsPerNode: number
      nodeAssignmentMargin: number
    }
  | {
      kind: "repairNode"
      sample: DatasetSample
      margin: number
    }
  | {
      kind: "simplifyPathComponent"
      params: Omit<ConstructorParameters<typeof MultiSimplifiedPathSolver>[0], "connMap">
      connectivityNetMap: Record<string, string[]>
      connectivityIdToNetMap: Record<string, string>
    }

export type ParallelStageWorkerResult =
  | NegotiatedPathingRouteResult
  | ({ kind: "pathingLandmark" } & TinyLandmarkDistances)
  | ParallelRegionalFallbackResult
  | ParallelRegionalB01CandidateResult
  | { kind: "forceImproveNode"; routes: HighDensityRoute[] }
  | {
      kind: "repairNode"
      repairedRoutes: RepairHdRoute[]
      stats: Record<string, unknown>
    }
  | { kind: "simplifyPathComponent"; routes: HighDensityRoute[] }

export type ParallelStageWorkerPool = {
  run<T>(job: ParallelStageWorkerJob): Promise<T>
}
