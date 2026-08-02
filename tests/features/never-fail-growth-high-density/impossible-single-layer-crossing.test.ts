import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { makeCrossingSingleLayerNode } from "./test-helpers"

test("GrowShrinkHighDensityIntraNodeSolver does not accept crossing geometry", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeCrossingSingleLayerNode(),
  })

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.activeSubSolver).toBeNull()
  expect(solver.growthAttempts).toBe(0)
  expect(solver.iterations).toBe(0)
  expect(solver.stats.invalidGeometryFallback).not.toBe(true)
  expect(solver.solvedRoutes).toHaveLength(0)

  solver.step()
  expect(solver.activeSubSolver).not.toBeNull()
})
