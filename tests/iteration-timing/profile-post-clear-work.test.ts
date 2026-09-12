import { expect, test } from "bun:test"
import { BaseSolver } from "../../lib/solvers/BaseSolver"
import { classifyIteration } from "../../scripts/iteration-timing/iterationTimingReport"
import { profileSolverIterations } from "../../scripts/iteration-timing/profileSolverIterations"

test("a leaf whitelist cannot cover root work after clearing that leaf", (): void => {
  let time = 0
  class LeafSolver extends BaseSolver {
    override _step(): void {
      time += 10
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
      time += 1_200
      this.solved = true
    }
  }
  const profile = profileSolverIterations(new RootSolver(), { now: () => time })
  const iteration = profile.iterations[0]!
  expect(iteration.attributions).toEqual([
    {
      solverName: "RootSolver",
      phase: "step",
      localIteration: 1,
      path: ["RootSolver"],
      elapsedMs: 1_200,
    },
    {
      solverName: "LeafSolver",
      phase: "step",
      localIteration: 1,
      path: ["RootSolver", "LeafSolver"],
      elapsedMs: 10,
    },
  ])
  expect(
    classifyIteration(iteration, [
      {
        solverName: "LeafSolver",
        phase: "step",
        localIteration: 1,
        reason: "A known leaf must not exempt later root work",
      },
    ]),
  ).toMatchObject({
    whitelisted: false,
    unlistedAttributions: [iteration.attributions[0]],
  })
})
