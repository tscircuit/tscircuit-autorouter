import { expect, test } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { emptyVisualization, makeNode } from "./test-helpers"

test("HighDensitySolver exposes live growth attempts from its shared counter", () => {
  const highDensitySolver = new HighDensitySolver({
    nodePortPoints: [makeNode()],
    useGrowShrinkHighDensityIntraNodeSolver: true,
  })
  highDensitySolver.step()

  const growShrinkSolver =
    highDensitySolver.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver
  growShrinkSolver.activeSubSolver = {
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

  highDensitySolver.step()

  expect(growShrinkSolver.growthAttempts).toBe(1)
  expect(highDensitySolver.getHighDensityGrowthAttemptCount()).toBe(1)
})
