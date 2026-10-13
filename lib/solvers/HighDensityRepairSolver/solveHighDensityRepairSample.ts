import { HighDensityRepairSolver, type DatasetSample, type HdRoute } from "high-density-repair02"

export type HighDensityRepairSampleInput = {
  sample: DatasetSample
  margin: number
}

export type HighDensityRepairSampleResult = {
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
  const solver = new HighDensityRepairSolver({
    repairBoundaryDiagonals: false,
    sample: input.sample,
    margin: input.margin,
  })
  solver.solve()
  if (solver.failed || !solver.solved) {
    throw new Error(solver.error ?? "High density repair sample did not solve")
  }
  return {
    repairedRoutes: solver.getOutput().repairedRoutes,
    stats: {
      nodeClearanceInitialConflictCount: Number(solver.stats.nodeClearanceInitialConflictCount ?? 0),
      nodeClearanceFinalConflictCount: Number(solver.stats.nodeClearanceFinalConflictCount ?? 0),
      nodeClearanceCandidateCount: Number(solver.stats.nodeClearanceCandidateCount ?? 0),
    },
  }
}
