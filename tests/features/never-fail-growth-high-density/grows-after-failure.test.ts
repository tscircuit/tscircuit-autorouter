import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { emptyVisualization, makeNode } from "./test-helpers"

test("GrowShrinkHighDensityIntraNodeSolver grows after an inner solver failure", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    maxGrowthAttempts: 1,
  })

  solver.activeSubSolver = {
    failed: false,
    solved: false,
    error: null,
    solvedRoutes: [],
    step() {
      this.failed = true
      this.error = "forced failure"
    },
    visualize: emptyVisualization,
  } as any

  solver.step()

  expect(solver.failed).toBe(false)
  expect(solver.growthAttempts).toBe(1)
  expect(solver.scaleFactor).toBe(2)
  expect(solver.failedSolvers.length).toBe(1)
})
