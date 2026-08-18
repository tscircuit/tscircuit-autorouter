import type { BaseSolver } from "./BaseSolver"
import { getPendingEffectsFromSolverTree } from "./getPendingEffectsFromSolverTree"

/**
 * Advances a synchronous step-based solver and yields when the active solver
 * tree exposes asynchronous effects.
 */
export async function stepSolverAsync(solver: BaseSolver): Promise<void> {
  if (solver.solved || solver.failed) return

  solver.step()
  const pendingEffects = getPendingEffectsFromSolverTree(solver)
  if (pendingEffects.length === 0) return

  await Promise.race(
    pendingEffects.map((effect) =>
      effect.promise.then(
        () => effect.name,
        () => effect.name,
      ),
    ),
  )

  if (!solver.solved && !solver.failed) {
    solver.step()
  }
}

/** Solves a step-based solver without blocking its pending promises. */
export async function solveSolverAsync(solver: BaseSolver): Promise<void> {
  const startTime = Date.now()

  while (!solver.solved && !solver.failed) {
    await stepSolverAsync(solver)
  }

  solver.timeToSolve = Date.now() - startTime
}
