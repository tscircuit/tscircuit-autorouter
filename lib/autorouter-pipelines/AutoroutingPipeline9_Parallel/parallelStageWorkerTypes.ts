import type { DatasetSample, HdRoute as RepairHdRoute } from "high-density-repair02"
import type { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute, NodeWithPortPoints } from "../../types/high-density-types"
import type { Pipeline9RegionalB01CandidateParams } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"

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
  | {
      kind: "regionalB01Candidate"
      params: Omit<Pipeline9RegionalB01CandidateParams, "connMap">
      connectivityNetMap: Record<string, string[]>
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
    }

export type ParallelStageWorkerResult =
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
