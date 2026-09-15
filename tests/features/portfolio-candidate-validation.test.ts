import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const node: NodeWithPortPoints = {
  capacityMeshNodeId: "candidate-validation",
  width: 4,
  height: 4,
  center: { x: 0, y: 0 },
  availableZ: [0, 1],
  portPoints: [
    { connectionName: "signal", x: -2, y: 0, z: 0 },
    { connectionName: "signal", x: 2, y: 0, z: 0 },
  ],
}

test("continues the portfolio after a solved candidate fails validation", () => {
  let validationCount = 0
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: node,
    cacheProvider: null,
    candidateValidator: () => {
      validationCount++
      return validationCount > 1
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(validationCount).toBe(2)
  expect(solver.stats.candidateRejectionCount).toBe(1)
  expect(solver.solvedRoutes).toHaveLength(1)
})
