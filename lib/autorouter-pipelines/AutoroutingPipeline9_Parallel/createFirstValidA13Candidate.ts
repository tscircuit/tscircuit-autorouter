import { HighDensitySolverA13WithDrcValidation } from "../../solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation"
import { PortfolioSingleIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { FirstValidA13CandidateJob } from "./firstValidA13CandidateTypes"
import { restoreWorkerConnectivityMap } from "./restoreWorkerConnectivityMap"

/** Reuse the original physical-width factory and its public effort budgets. */
export function createFirstValidA13Candidate(job: FirstValidA13CandidateJob): HighDensitySolverA13WithDrcValidation {
  const portfolio = new PortfolioSingleIntraNodeSolver({
    ...job.params,
    connMap: restoreWorkerConnectivityMap(job),
  })
  const candidate = portfolio.generateSolver({ HIGH_DENSITY_A13: true, SHUFFLE_SEED: 0 })
  if (!(candidate instanceof HighDensitySolverA13WithDrcValidation)) {
    throw new Error("First-valid A13 factory returned a different solver")
  }
  return candidate
}
