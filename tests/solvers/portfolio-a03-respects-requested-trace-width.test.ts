import { expect, test } from "bun:test"
import type { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("A03 receives the board minimum instead of routing narrower copper", (): void => {
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "width-regression",
      center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0],
      portPoints: [
        { x: -2, y: 0, z: 0, connectionName: "signal" },
        { x: 2, y: 0, z: 0, connectionName: "signal" },
      ],
    },
    traceWidth: 0.1524, viaDiameter: 0.2032,
  })
  const solver = portfolio.generateSolver({
    HIGH_DENSITY_A03: true,
  }) as unknown as HighDensitySolverA03
  expect(solver.traceThickness).toBe(0.1524)
  solver.solve()
  expect(solver.solved).toBeTrue()
  const routes = solver.getOutput()
  expect(routes.length).toBeGreaterThan(0)
  expect(routes.every((route) => route.traceThickness === 0.1524)).toBeTrue()
})
