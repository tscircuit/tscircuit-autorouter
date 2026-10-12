import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("counts A01 completed routes before expanding the initial portfolio", (): void => {
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "parallel-routes",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "a", x: -1, y: -0.5, z: 0 },
        { connectionName: "a", x: 1, y: -0.5, z: 0 },
        { connectionName: "b", x: -1, y: 0.5, z: 0 },
        { connectionName: "b", x: 1, y: 0.5, z: 0 },
      ],
    },
  })
  const solver = portfolio.generateSolver({ HIGH_DENSITY_A01: true })
  expect(solver).toBeInstanceOf(HighDensitySolverA01)
  const grid = solver as unknown as HighDensitySolverA01
  for (let iteration = 0; iteration < 2_000; iteration++) {
    grid.step()
    if (grid.solvedConnectionsMap.size > 0) break
  }
  expect(grid.failed).toBe(false)
  expect(grid.solved).toBe(false)
  expect(grid.progress).toBe(0)
  expect(grid.solvedConnectionsMap.size).toBe(1)
  expect(portfolio.adaptiveSearchExpanded).toBe(false)
  expect(portfolio.computeH(solver)).toBeLessThan(1)
})
