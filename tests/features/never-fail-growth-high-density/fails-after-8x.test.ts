import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { emptyVisualization, makeNode } from "./test-helpers"

test("GrowShrinkHighDensityIntraNodeSolver fails after an 8x resize fails", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
  })

  const forceFailure = () => {
    solver.activeSubSolver = {
      failed: false,
      solved: false,
      error: null,
      solvedRoutes: [],
      step() {
        this.failed = true
        this.error = `forced failure at ${solver.scaleFactor}x`
      },
      visualize: emptyVisualization,
    } as any
    solver.step()
  }

  forceFailure()
  expect(solver.failed).toBe(false)
  expect(solver.scaleFactor).toBe(2)

  forceFailure()
  expect(solver.failed).toBe(false)
  expect(solver.scaleFactor).toBe(4)

  forceFailure()
  expect(solver.failed).toBe(false)
  expect(solver.scaleFactor).toBe(8)

  forceFailure()
  expect(solver.failed).toBe(true)
  expect(solver.growthAttempts).toBe(3)
  expect(solver.failedSolvers.length).toBe(4)
  expect(solver.error).toContain("resizing to 8x")
})

test("GrowShrinkHighDensityIntraNodeSolver can fall back to invalid geometry after resize failures", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    fallbackToInvalidGeometryOnFailure: true,
  })

  const forceFailure = () => {
    solver.activeSubSolver = {
      failed: false,
      solved: false,
      error: null,
      solvedRoutes: [],
      step() {
        this.failed = true
        this.error = `forced failure at ${solver.scaleFactor}x`
      },
      visualize: emptyVisualization,
    } as any
    solver.step()
  }

  forceFailure()
  forceFailure()
  forceFailure()
  forceFailure()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(solver.stats.invalidGeometryFallback).toBe(true)
  expect(solver.stats.reason).toBe("growth attempts exhausted")
  expect(solver.solvedRoutes).toHaveLength(1)
})
