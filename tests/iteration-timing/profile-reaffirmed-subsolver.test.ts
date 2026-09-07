import { expect, test } from "bun:test"
import { BaseSolver } from "../../lib/solvers/BaseSolver"
import { profileSolverIterations } from "../../scripts/iteration-timing/profileSolverIterations"

test("reaffirming the active child does not create false iteration ranges", (): void => {
  let time = 0
  class LeafSolver extends BaseSolver {
    override _step(): void {
      time += 1_200
      this.solved = this.iterations === 3
    }
  }
  class RootSolver extends BaseSolver {
    leaf = new LeafSolver()

    constructor() {
      super()
      this.activeSubSolver = this.leaf
    }

    override _step(): void {
      time += 200
      this.activeSubSolver = this.leaf
      this.leaf.step()
      this.solved = this.leaf.solved
    }
  }
  const profile = profileSolverIterations(new RootSolver(), { now: () => time })
  expect(profile.iterations).toHaveLength(3)
  for (const [index, iteration] of profile.iterations.entries()) {
    expect(iteration.attributions).toEqual([
      {
        solverName: "LeafSolver",
        phase: "step",
        localIteration: index + 1,
        path: ["RootSolver", "LeafSolver"],
        elapsedMs: 1_400,
      },
    ])
    expect(iteration.iterationEnd).toBeUndefined()
  }
  expect(profile.solverTimings).toEqual([
    {
      solverName: "LeafSolver",
      phase: "step",
      iterations: 3,
      totalMs: 4_200,
      maxMs: 1_400,
    },
  ])
})
