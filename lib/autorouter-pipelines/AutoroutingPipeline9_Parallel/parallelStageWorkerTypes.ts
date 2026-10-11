import type { DatasetSample, HdRoute as RepairHdRoute } from "high-density-repair02"
import type { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute, NodeWithPortPoints } from "../../types/high-density-types"

export type ParallelStageWorkerJob =
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
