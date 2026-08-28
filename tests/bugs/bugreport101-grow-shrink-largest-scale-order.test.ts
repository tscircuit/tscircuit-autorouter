import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"

test("bugreport101 grow-shrink tries 8x before backfilling 2x and 4x", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "bugreport101-growth-node",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      portPoints: [
        { connectionName: "a", x: -0.5, y: 0, z: 0 },
        { connectionName: "a", x: 0.5, y: 0, z: 0 },
      ],
    },
    maxGrowthAttempts: 3,
    tryLargestScaleAsRepairSeedAfterInitialFailure: true,
  })
  const attemptedScales: number[] = []
  const forceFailure = () => {
    attemptedScales.push(solver.scaleFactor)
    solver.activeSubSolver = {
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

  expect(solver.scaleFactorSequence).toEqual([1, 8, 2, 4])
  expect(solver.scaleFactor).toBe(1)

  forceFailure()
  expect(solver.failed).toBe(false)
  expect(solver.growthAttempts).toBe(1)
  expect(solver.scaleFactor).toBe(8)

  forceFailure()
  expect(solver.failed).toBe(false)
  expect(solver.growthAttempts).toBe(2)
  expect(solver.scaleFactor).toBe(2)

  forceFailure()
  expect(solver.failed).toBe(false)
  expect(solver.growthAttempts).toBe(3)
  expect(solver.scaleFactor).toBe(4)

  forceFailure()
  expect(attemptedScales).toEqual([1, 8, 2, 4])
  expect(solver.failed).toBe(true)
  expect(solver.growthAttempts).toBe(3)
  expect(solver.scaleFactor).toBe(4)
  expect(solver.failedSolvers).toHaveLength(4)
  expect(solver.error).toContain("trying scales 1x, 8x, 2x, 4x")
})
