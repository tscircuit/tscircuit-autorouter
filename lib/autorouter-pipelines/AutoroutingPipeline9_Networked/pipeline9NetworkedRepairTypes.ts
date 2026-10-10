import type {
  DatasetSample,
  HdRoute as RepairHdRoute,
} from "high-density-repair02"

export const PIPELINE9_NETWORKED_REPAIR_POLICY = "high_density_repair_v1" as const

/** A frozen node repair sample, including nearby fixed copper and obstacles. */
export type Pipeline9NetworkedHighDensityRepairInput = {
  solvePolicy: typeof PIPELINE9_NETWORKED_REPAIR_POLICY
  sample: DatasetSample
  repairMargin: number
}

export type Pipeline9NetworkedRepairClearanceStats = {
  nodeClearanceInitialConflictCount: number
  nodeClearanceFinalConflictCount: number
  nodeClearanceCandidateCount: number
}

export type Pipeline9NetworkedHighDensityRepairOutput =
  | {
      status: "solved"
      solutionStage: "repair"
      repairedRoutes: RepairHdRoute[]
      clearanceStats: Pipeline9NetworkedRepairClearanceStats
    }
  | {
      status: "failed"
      solutionStage: "repair"
      error: string
    }
