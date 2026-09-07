import { expect, test } from "bun:test"
import { BaseSolver } from "../../lib/solvers/BaseSolver"
import { profileSolverIterations } from "../../scripts/iteration-timing/profileSolverIterations"

test("retains blocking root steps made of individually short deepest solver calls", (): void => {
  let time = 0
  class RepeatedLeafSolver extends BaseSolver {
    override _step(): void {
      time += 20
      this.solved = this.iterations === 60
    }
  }
  class RootSolver extends BaseSolver {
    override _step(): void {
      new RepeatedLeafSolver().solve()
      this.solved = true
    }
  }
  const profile = profileSolverIterations(new RootSolver(), {
    thresholdMs: 1_000,
    now: () => time,
  })
  expect(profile.maxIterationMs).toBe(1_200)
  expect(profile.iterations[0]).toMatchObject({
    solverName: "RepeatedLeafSolver",
    localIteration: 1,
    iterationEnd: 60,
    elapsedMs: 1_200,
  })
  expect(profile.solverTimings).toEqual([
    {
      solverName: "RepeatedLeafSolver",
      phase: "step",
      iterations: 60,
      totalMs: 1_200,
      maxMs: 20,
    },
  ])
})
