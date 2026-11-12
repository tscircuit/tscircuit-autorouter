import type { BaseSolver } from "lib/solvers/BaseSolver"

type PhasedSolver = BaseSolver & { getCurrentPhase(): string }

/** A terminal solver cannot advance to another phase. */
export function stepUntilPhase(solver: PhasedSolver, phase: string): void {
  while (!solver.failed) {
    if (solver.getCurrentPhase() === phase) return
    if (solver.solved) {
      throw new Error(`Routing finished before phase "${phase}" was reached`)
    }
    solver.step()
  }
  throw new Error(solver.error ?? `Routing failed before phase "${phase}"`)
}
