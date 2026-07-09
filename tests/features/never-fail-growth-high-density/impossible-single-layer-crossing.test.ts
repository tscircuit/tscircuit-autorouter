import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { makeCrossingSingleLayerNode } from "./test-helpers"

test("GrowShrinkHighDensityIntraNodeSolver fails immediately for impossible single-layer crossings", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeCrossingSingleLayerNode(),
  })

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.activeSubSolver).toBeNull()
  expect(solver.growthAttempts).toBe(0)
  expect(solver.iterations).toBe(0)
  expect(solver.stats.impossibleGeometry).toBe(true)
  expect(solver.stats.reason).toBe(
    "single-layer node has different-root same-layer crossings",
  )
  expect(solver.error).toContain("single-layer node")
  expect(solver.solvedRoutes).toHaveLength(0)
})
