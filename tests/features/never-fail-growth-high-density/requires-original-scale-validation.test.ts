import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import {
  emptyVisualization,
  makeCrossingSingleLayerNode,
  makeNode,
  makeScaledRoute,
} from "./test-helpers"

test("GrowShrinkHighDensityIntraNodeSolver opts into original-scale validation and fail-loud behavior", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    maxGrowthAttempts: 1,
    growShrinkRequireOriginalScaleValidation: true,
  })
  solver.scaleFactor = 2
  solver.growthAttempts = 1
  solver.activeSubSolver = {
    failed: false,
    solved: false,
    error: null,
    solvedRoutes: [makeScaledRoute()],
    step() {
      this.solved = true
    },
    visualize: emptyVisualization,
  } as any

  solver.step()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.solvedRoutes).toEqual([])
  expect(solver.error).toContain(
    "scaled solutions require validation at the original scale",
  )

  const impossibleSolver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeCrossingSingleLayerNode(),
    fallbackToInvalidGeometryOnFailure: true,
    growShrinkRequireOriginalScaleValidation: true,
  })
  expect(impossibleSolver.solved).toBe(false)
  expect(impossibleSolver.failed).toBe(true)
  expect(impossibleSolver.solvedRoutes).toEqual([])
  expect(impossibleSolver.error).toContain(
    "cannot route an impossible single-layer crossing",
  )
})
