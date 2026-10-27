import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"

test("grow/shrink releases failed portfolios without debug capture and preserves retry behavior", () => {
  let reference: { iterations: number; error: string | null } | undefined
  for (const captureSearchDebug of [undefined, true, false]) {
    const solver = new GrowShrinkHighDensityIntraNodeSolver({
      nodeWithPortPoints: {
        capacityMeshNodeId: "retired-search-history",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0, 1],
        portPoints: [
          { x: -1, y: 0, z: 0, connectionName: "horizontal" },
          { x: 1, y: 0, z: 0, connectionName: "horizontal" },
          { x: 0, y: -1, z: 0, connectionName: "vertical" },
          { x: 0, y: 1, z: 0, connectionName: "vertical" },
        ],
      },
      maxGrowthAttempts: 2,
      maxInnerIterationsPerGrowthAttempt: 1,
      growShrinkSolutionValidator: () => false,
      captureSearchDebug,
    })
    solver.solve()
    expect(solver.failed).toBeTrue()
    expect(solver.solved).toBeFalse()
    expect(solver.growthAttempts).toBe(2)
    expect(solver.scaleFactor).toBe(4)
    expect(solver.failedSolvers).toHaveLength(
      captureSearchDebug === false ? 0 : 3,
    )
    expect(solver.activeSubSolver).toBeNull()
    const result = { iterations: solver.iterations, error: solver.error }
    if (reference) expect(result).toEqual(reference)
    reference = result
  }
})
