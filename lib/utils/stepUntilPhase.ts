import type { BaseSolver } from "lib/solvers/BaseSolver"

type PhasedSolver = BaseSolver & { getCurrentPhase(): string }

export function stepUntilPhase(solver: PhasedSolver, phase: string): void {
  while (true) {
    // A step can both enter the requested phase and fail its iteration budget.
    if (solver.failed) {
      throw new Error(solver.error ?? `Routing failed before phase "${phase}"`)
    }
    if (solver.getCurrentPhase() === phase) return
    if (solver.solved) {
      throw new Error(`Routing finished before phase "${phase}" was reached`)
    }
    solver.step()
  }
}
