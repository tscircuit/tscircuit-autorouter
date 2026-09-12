import { expect, test } from "bun:test"
import { BaseSolver } from "../../lib/solvers/BaseSolver"
import { profileSolverIterations } from "../../scripts/iteration-timing/profileSolverIterations"

test("restores profiling hooks and permits another run after a solver throws", (): void => {
  const failure = new Error("solver invariant failed")
  class ThrowingSolver extends BaseSolver {
    override step(): void {
      throw failure
    }
  }
  class SuccessfulSolver extends BaseSolver {
    override _step(): void {
      this.solved = true
    }
  }
  const originalStep = BaseSolver.prototype.step
  const originalThrowingStep = ThrowingSolver.prototype.step
  expect(() => profileSolverIterations(new ThrowingSolver())).toThrow(failure)
  expect(BaseSolver.prototype.step).toBe(originalStep)
  expect(ThrowingSolver.prototype.step).toBe(originalThrowingStep)
  expect(profileSolverIterations(new SuccessfulSolver()).totalIterations).toBe(
    1,
  )
})
