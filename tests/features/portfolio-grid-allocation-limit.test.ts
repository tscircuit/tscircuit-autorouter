import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("resized grid candidates fail before allocating oversized routing grids", (): void => {
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "resized",
      center: { x: 0, y: 0 },
      width: 200,
      height: 200,
      availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
      portPoints: [
        { x: -100, y: 0, z: 0, connectionName: "signal" },
        { x: 100, y: 0, z: 0, connectionName: "signal" },
      ],
    },
    layerCount: 8,
    enableNegotiatedSearch: true,
  })
  portfolio.initializeSolvers()
  const gridCandidates = portfolio.supervisedSolvers!.filter(
    ({ hyperParameters }) =>
      hyperParameters.HIGH_DENSITY_A01 ||
      hyperParameters.HIGH_DENSITY_A03 ||
      hyperParameters.HIGH_DENSITY_A13,
  )
  expect(gridCandidates).toHaveLength(3)
  for (const { solver } of gridCandidates) {
    expect(solver.failed).toBe(true)
    expect(solver.error).toContain("exceeds allocation budget")
  }
  portfolio["expandAdaptiveSearch"]()
  expect(portfolio.stats.adaptiveSearchExpanded).toBe(true)
  expect(portfolio.stats.bestProgressAtExpansion).toBeFinite()
})
