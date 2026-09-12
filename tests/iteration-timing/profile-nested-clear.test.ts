import { expect, test } from "bun:test"
import { BaseSolver } from "../../lib/solvers/BaseSolver"
import { profileSolverIterations } from "../../scripts/iteration-timing/profileSolverIterations"

test("refreshes paused ancestors when a nested active leaf is cleared", (): void => {
  let time = 0
  class LeafSolver extends BaseSolver {
    override _step(): void {
      time += 10
      this.solved = true
    }
  }
  class IntermediateSolver extends BaseSolver {
    constructor() {
      super()
      this.activeSubSolver = new LeafSolver()
    }

    override _step(): void {
      this.activeSubSolver!.step()
      this.activeSubSolver = null
      time += 1_200
      this.solved = true
    }
  }
  class RootSolver extends BaseSolver {
    constructor() {
      super()
      this.activeSubSolver = new IntermediateSolver()
    }

    override _step(): void {
      this.activeSubSolver!.step()
      time += 100
      this.solved = true
    }
  }
  const profile = profileSolverIterations(new RootSolver(), { now: () => time })
  expect(profile.iterations[0]?.elapsedMs).toBe(1_310)
  expect(profile.iterations[0]?.attributions).toEqual([
    {
      solverName: "IntermediateSolver",
      phase: "step",
      localIteration: 1,
      path: ["RootSolver", "IntermediateSolver"],
      elapsedMs: 1_300,
    },
    {
      solverName: "LeafSolver",
      phase: "step",
      localIteration: 1,
      path: ["RootSolver", "IntermediateSolver", "LeafSolver"],
      elapsedMs: 10,
    },
  ])
})
