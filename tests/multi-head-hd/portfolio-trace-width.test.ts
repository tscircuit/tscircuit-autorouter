import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("the multi-head portfolio candidate routes using the requested trace width", (): void => {
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "width-contract",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1, 2, 3],
      portPoints: [
        { x: -2, y: -0.7, z: 0, connectionName: "signal" },
        { x: 2, y: -0.7, z: 0, connectionName: "signal" },
        { x: -2, y: 0.7, z: 0, connectionName: "other" },
        { x: 2, y: 0.7, z: 0, connectionName: "other" },
      ],
    },
    traceWidth: 0.07,
    viaDiameter: 0.3,
    layerCount: 4,
  })
  const candidate = portfolio.generateSolver({ MULTI_HEAD_POLYLINE_SOLVER: true })
  candidate.solve()
  expect({ solved: candidate.solved, error: candidate.error }).toEqual({
    solved: true,
    error: null,
  })
  expect(candidate.solvedRoutes).toHaveLength(2)
  expect(
    candidate.solvedRoutes.every((route): boolean => route.traceThickness === 0.07),
  ).toBe(true)
})
