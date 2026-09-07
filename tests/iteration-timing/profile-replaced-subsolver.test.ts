import { expect, test } from "bun:test"
import { BaseSolver } from "../../lib/solvers/BaseSolver"
import { profileSolverIterations } from "../../scripts/iteration-timing/profileSolverIterations"

test("replacement initialization cannot absorb parent teardown after a clear", (): void => {
  let time = 0
  class LeafSolver extends BaseSolver {
    override _step(): void {
      time += 10
      this.solved = true
    }
  }
  class ReplacementSolver extends BaseSolver {
    constructor() {
      super()
      time += 500
    }

    override _step(): void {
      time += 30
      this.solved = true
    }
  }
  class RootSolver extends BaseSolver {
    constructor() {
      super()
      this.activeSubSolver = new LeafSolver()
    }

    override _step(): void {
      this.activeSubSolver!.step()
      this.activeSubSolver = null
      time += 700
      this.activeSubSolver = new ReplacementSolver()
      this.activeSubSolver.step()
      this.solved = true
    }
  }
  const profile = profileSolverIterations(new RootSolver(), { now: () => time })
  expect(profile.iterations[0]?.attributions).toEqual([
    {
      solverName: "RootSolver",
      phase: "step",
      localIteration: 1,
      path: ["RootSolver"],
      elapsedMs: 1_200,
    },
    {
      solverName: "ReplacementSolver",
      phase: "step",
      localIteration: 1,
      path: ["RootSolver", "ReplacementSolver"],
      elapsedMs: 30,
    },
    {
      solverName: "LeafSolver",
      phase: "step",
      localIteration: 1,
      path: ["RootSolver", "LeafSolver"],
      elapsedMs: 10,
    },
  ])
})
