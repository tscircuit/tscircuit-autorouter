import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const node: NodeWithPortPoints = {
  capacityMeshNodeId: "grow-before-alternative-candidates",
  width: 4,
  height: 4,
  center: { x: 0, y: 0 },
  availableZ: [0, 1],
  portPoints: [
    { connectionName: "signal", x: -2, y: 0, z: 0 },
    { connectionName: "signal", x: 2, y: 0, z: 0 },
  ],
}

test("grows before selecting a lower-ranked validated candidate", () => {
  let validationCount = 0
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: node,
    cacheProvider: null,
    growShrinkSolutionValidator: () => {
      validationCount++
      return validationCount > 1
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(validationCount).toBe(2)
  expect(solver.growthAttempts).toBe(1)
  expect(solver.stats.alternativeCandidateSearch).toBeUndefined()
  expect(solver.winningSolver?.stats.candidateRejectionCount).toBeUndefined()
})
