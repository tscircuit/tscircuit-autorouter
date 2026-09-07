import { expect, test } from "bun:test"
import { BaseSolver } from "../../lib/solvers/BaseSolver"
import { profileSolverIterations } from "../../scripts/iteration-timing/profileSolverIterations"

test("counts actual root and child calls when step overrides never increment iterations", (): void => {
  let time = 0
  class LeafSolver extends BaseSolver {
    calls = 0

    override step(): void {
      time += 1_200
      this.calls++
      this.solved = this.calls === 3
    }
  }
  class RootSolver extends BaseSolver {
    constructor() {
      super()
      this.activeSubSolver = new LeafSolver()
    }

    override step(): void {
      this.activeSubSolver!.step()
      this.solved = this.activeSubSolver!.solved
    }
  }
  const solver = new RootSolver()
  const profile = profileSolverIterations(solver, { now: () => time })
  expect(solver.iterations).toBe(0)
  expect(solver.activeSubSolver!.iterations).toBe(0)
  expect(profile.totalIterations).toBe(3)
  expect(profile.iterations.map((item) => item.rootIteration)).toEqual([1, 2, 3])
  expect(profile.iterations.map((item) => item.localIteration)).toEqual([1, 2, 3])
  expect(profile.solverTimings[0]).toMatchObject({
    solverName: "LeafSolver",
    iterations: 3,
    totalMs: 3_600,
    maxMs: 1_200,
  })
})
