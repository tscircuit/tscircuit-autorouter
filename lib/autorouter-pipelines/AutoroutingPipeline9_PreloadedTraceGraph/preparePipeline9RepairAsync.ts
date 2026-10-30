import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { RelaxTraceClearanceSolver } from "@tscircuit/repair04"
import type { BaseSolver } from "../../solvers/BaseSolver"

/** Prepare immutable work while the owning pipeline retains every native step. */
export async function preparePipeline9RepairAsync(
  solver: BaseSolver,
  runtime: SolverRuntimeExecutor,
  remainingIterations: number,
): Promise<void> {
  let child: BaseSolver | null | undefined = solver
  let remaining = remainingIterations
  while (child && !child.solved && !child.failed) {
    remaining = Math.min(remaining, child.MAX_ITERATIONS - child.iterations)
    if (remaining <= 0) return
    if (child instanceof RelaxTraceClearanceSolver) {
      await child.prepareAsync(runtime, remaining)
      return
    }
    child = child.activeSubSolver
  }
}
