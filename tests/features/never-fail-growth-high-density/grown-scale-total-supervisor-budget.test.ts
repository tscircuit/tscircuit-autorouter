import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { createInvalidDirectConnectionRoutes } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/invalidSameLayerCrossingGeometry"
import { makeNode } from "./test-helpers"

test("GrowShrink shares one supervisor budget across 8x, 2x, and 4x attempts", () => {
  const node = makeNode()
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: node,
    maxTotalGrownScaleSupervisorIterations: 12,
    tryLargestScaleAsRepairSeedAfterInitialFailure: true,
    fallbackToInvalidGeometryOnFailure: true,
  })
  const forceFailure = (iterations: number) => {
    solver.activeSubSolver = {
      iterations,
      failed: false,
      solved: false,
      error: null,
      solvedRoutes: [],
      step() {
        this.failed = true
        this.error = `forced failure at ${solver.scaleFactor}x`
      },
    } as any
    solver.step()
  }

  forceFailure(1_000)
  expect(solver.scaleFactor).toBe(8)
  expect(solver.grownScaleSupervisorIterationsUsed).toBe(0)
  ;(solver as any).createActiveSubSolver()
  expect(solver.activeSubSolver?.maxSupervisorIterations).toBe(12)
  forceFailure(4)
  expect(solver.scaleFactor).toBe(2)
  ;(solver as any).createActiveSubSolver()
  expect(solver.activeSubSolver?.maxSupervisorIterations).toBe(8)
  forceFailure(3)
  expect(solver.scaleFactor).toBe(4)
  ;(solver as any).createActiveSubSolver()
  expect(solver.activeSubSolver?.maxSupervisorIterations).toBe(5)
  forceFailure(5)

  expect(solver.grownScaleSupervisorIterationsUsed).toBe(12)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.invalidGeometryFallback).toBe(true)
  expect(solver.stats.reason).toBe("grown-scale supervisor budget exhausted")
  expect(solver.solvedRoutes).toEqual(
    createInvalidDirectConnectionRoutes(node, 0.15, 0.3),
  )
})
