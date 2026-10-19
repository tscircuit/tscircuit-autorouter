import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("the ordinary detailed-routing portfolio respects each connection's layers", () => {
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 6, height: 4,
      availableZ: [0, 1, 2, 3],
      allowedZByConnection: { signal: [0, 3], barrier: [0, 3] },
      portPoints: [
        { connectionName: "signal", x: -2, y: 0, z: 0 },
        { connectionName: "signal", x: 2, y: 0, z: 0 },
        { connectionName: "barrier", x: 0, y: -2, z: 0 },
        { connectionName: "barrier", x: 0, y: 2, z: 0 },
      ],
    },
    layerCount: 4,
  })
  solver.initializeSolvers()
  const a01 = solver.supervisedSolvers!.find((candidate) =>
    candidate.solver instanceof HighDensitySolverA01,
  )!.solver
  a01.solve()
  expect(a01.solved).toBe(true)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes).toHaveLength(2)
  expect(solver.solvedRoutes.every((route) =>
    route.route.every((point) => point.z === 0 || point.z === 3),
  )).toBe(true)
  expect(solver.winningSolver).not.toBe(a01)
})
