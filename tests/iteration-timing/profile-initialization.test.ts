import { expect, test } from "bun:test"
import { BaseSolver as ExternalBaseSolver } from "@tscircuit/solver-utils"
import { BaseSolver } from "../../lib/solvers/BaseSolver"
import { profileSolverIterations } from "../../scripts/iteration-timing/profileSolverIterations"

test("separates initialization from external nested solve calls in a constructor", (): void => {
  let time = 0
  class ExternalLeafSolver extends ExternalBaseSolver {
    override _step(): void {
      time += 300
      this.solved = this.iterations === 2
    }
  }
  class NewStageSolver extends BaseSolver {
    constructor() {
      super()
      time += 400
      new ExternalLeafSolver().solve()
      this.solved = true
    }
  }
  class RootSolver extends BaseSolver {
    override _step(): void {
      this.activeSubSolver = new NewStageSolver()
      this.activeSubSolver = null
      this.solved = true
    }
  }
  const externalStep = ExternalBaseSolver.prototype.step
  const profile = profileSolverIterations(new RootSolver(), { now: () => time })
  expect(profile.iterations[0]?.elapsedMs).toBe(1_000)
  expect(profile.iterations[0]?.attributions).toEqual([
    {
      solverName: "ExternalLeafSolver",
      phase: "step",
      localIteration: 1,
      iterationEnd: 2,
      path: ["RootSolver", "ExternalLeafSolver"],
      elapsedMs: 600,
    },
    {
      solverName: "NewStageSolver",
      phase: "initialization",
      localIteration: 0,
      path: ["RootSolver", "NewStageSolver"],
      elapsedMs: 400,
    },
  ])
  expect(ExternalBaseSolver.prototype.step).toBe(externalStep)
})
