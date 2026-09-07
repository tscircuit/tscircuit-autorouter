import { expect, test } from "bun:test"
import { BaseSolver } from "../../lib/solvers/BaseSolver"
import { profileSolverIterations } from "../../scripts/iteration-timing/profileSolverIterations"

test("attributes a completed and cleared subsolver to its own iteration", (): void => {
  let time = 0
  class LeafSolver extends BaseSolver {
    override _step(): void {
      time += 1_200
      this.solved = true
    }
  }
  class ParentSolver extends BaseSolver {
    constructor() {
      super()
      this.activeSubSolver = new LeafSolver()
    }

    override _step(): void {
      this.activeSubSolver!.step()
      this.activeSubSolver = null
      this.solved = true
    }
  }
  const originalStep = BaseSolver.prototype.step
  const solver = new ParentSolver()
  const profile = profileSolverIterations(solver, { now: () => time })
  expect(profile.totalIterations).toBe(1)
  expect(profile.iterations).toHaveLength(1)
  expect(profile.iterations[0]).toMatchObject({
    rootIteration: 1,
    solverName: "LeafSolver",
    localIteration: 1,
    phase: "step",
    elapsedMs: 1_200,
    path: ["ParentSolver", "LeafSolver"],
  })
  expect(solver.activeSubSolver).toBeNull()
  expect(BaseSolver.prototype.step).toBe(originalStep)
  expect(
    Object.getOwnPropertyDescriptor(solver, "activeSubSolver")?.get,
  ).toBeUndefined()
})
