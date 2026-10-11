import { HighDensityRepairSolver } from "high-density-repair02"
import type {
  Pipeline9NetworkedHighDensityRepairInput,
  Pipeline9NetworkedHighDensityRepairOutput,
} from "./pipeline9NetworkedRepairTypes"
import { PIPELINE9_NETWORKED_REPAIR_POLICY } from "./pipeline9NetworkedRepairTypes"

/** Runs one frozen repair sample, including its neighboring fixed copper. */
export function solvePipeline9NetworkedHighDensityRepairNode(
  input: Pipeline9NetworkedHighDensityRepairInput,
): Pipeline9NetworkedHighDensityRepairOutput {
  if (input.solvePolicy !== PIPELINE9_NETWORKED_REPAIR_POLICY) {
    throw new Error(
      `Unsupported Pipeline9 repair policy ${String(input.solvePolicy)}`,
    )
  }
  const solver = new HighDensityRepairSolver({
    sample: input.sample,
    margin: input.repairMargin,
    repairBoundaryDiagonals: false,
  })
  solver.solve()
  if (!solver.solved) {
    return {
      status: "failed",
      solutionStage: "repair",
      error: solver.error || "Pipeline9 high-density repair failed",
    }
  }
  return {
    status: "solved",
    solutionStage: "repair",
    repairedRoutes: solver.getOutput().repairedRoutes,
    clearanceStats: {
      nodeClearanceInitialConflictCount: Number(
        solver.stats.nodeClearanceInitialConflictCount ?? 0,
      ),
      nodeClearanceFinalConflictCount: Number(
        solver.stats.nodeClearanceFinalConflictCount ?? 0,
      ),
      nodeClearanceCandidateCount: Number(
        solver.stats.nodeClearanceCandidateCount ?? 0,
      ),
    },
  }
}
