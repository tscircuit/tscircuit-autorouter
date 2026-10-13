import type { DatasetSample, HdRoute } from "high-density-repair02"
import { buildRepairFrames } from "high-density-repair02/lib/high-density-repair-solver/steps/buildRepairFrames"

export type HighDensityRepairSampleInput = {
  sample: DatasetSample
  margin: number
}

export type HighDensityRepairSampleResult = {
  /** Solver steps used to preserve the sequential stage's iteration budget. */
  iterations: number
  repairedRoutes: HdRoute[]
  stats: {
    nodeClearanceInitialConflictCount: number
    nodeClearanceFinalConflictCount: number
    nodeClearanceCandidateCount: number
  }
}

export type HighDensityRepairExecutor = (
  input: HighDensityRepairSampleInput,
) => Promise<HighDensityRepairSampleResult>

export type ParallelHighDensityRepairOptions = {
  /** Dispatch to a worker pool or remote executor; promises alone do not parallelize CPU work. */
  executor: HighDensityRepairExecutor
  /** Maximum number of in-flight samples. Defaults to 4. */
  concurrency?: number
}

/** Run this helper inside each worker to use the sequential repair policy exactly. */
export function solveHighDensityRepairSample(
  input: HighDensityRepairSampleInput,
): HighDensityRepairSampleResult {
  // This is the same function called by HighDensityRepairSolver._setup().
  // Its wrapper additionally enumerates trace violations for visualization,
  // which neither changes the repair nor contributes to the stage's stats.
  const result = buildRepairFrames(input.sample, input.margin, false, false)
  if (result.frames.length !== 1) {
    throw new Error("Node repair without progress capture must produce exactly one frame")
  }
  const stats = result.clearanceRepairStats
  return {
    // The sequential wrapper consumes this single frame in one solver step.
    iterations: 1,
    repairedRoutes: result.repairedRoutes,
    stats: {
      nodeClearanceInitialConflictCount: Number(stats?.nodeClearanceInitialConflictCount ?? 0),
      nodeClearanceFinalConflictCount: Number(stats?.nodeClearanceFinalConflictCount ?? 0),
      nodeClearanceCandidateCount: Number(stats?.nodeClearanceCandidateCount ?? 0),
    },
  }
}
