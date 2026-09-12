import { expect, test } from "bun:test"
import { BaseSolver } from "../../lib/solvers/BaseSolver"
import { profileSolverIterations } from "../../scripts/iteration-timing/profileSolverIterations"

test("assigns construction to the deepest newly active solver and keeps first step distinct", (): void => {
  let time = 0
  class DeepLeafSolver extends BaseSolver {
    constructor() {
      super()
      time += 200
    }

    override _step(): void {
      time += 150
      this.solved = true
    }
  }
  class IntermediateSolver extends BaseSolver {
    constructor() {
      super()
      this.activeSubSolver = new DeepLeafSolver()
    }

    override _step(): void {
      this.activeSubSolver!.step()
      this.activeSubSolver = null
      this.solved = true
    }
  }
  class RootSolver extends BaseSolver {
    override _step(): void {
      if (!this.activeSubSolver) {
        this.activeSubSolver = new IntermediateSolver()
        return
      }
      this.activeSubSolver.step()
      this.solved = true
    }
  }
  const profile = profileSolverIterations(new RootSolver(), { now: () => time })
  expect(profile.iterations).toMatchObject([
    {
      rootIteration: 1,
      solverName: "DeepLeafSolver",
      localIteration: 0,
      phase: "initialization",
      path: ["RootSolver", "IntermediateSolver", "DeepLeafSolver"],
    },
    {
      rootIteration: 2,
      solverName: "DeepLeafSolver",
      localIteration: 1,
      phase: "step",
      path: ["RootSolver", "IntermediateSolver", "DeepLeafSolver"],
    },
  ])
})
