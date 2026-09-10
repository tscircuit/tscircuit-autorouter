import { expect, test } from "bun:test"
import { HighDensitySolverA13 } from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("A13 provisional routes retain nonzero scheduling cost and respect effort", () => {
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "a13-provisional-crossing",
      width: 4,
      height: 4,
      center: { x: 0, y: 0 },
      availableZ: [0],
      portPoints: [
        { connectionName: "a", x: -2, y: 0, z: 0 },
        { connectionName: "a", x: 2, y: 0, z: 0 },
        { connectionName: "b", x: 0, y: -2, z: 0 },
        { connectionName: "b", x: 0, y: 2, z: 0 },
      ],
    },
    traceWidth: 0.15,
    viaDiameter: 0.4,
    effort: 0.5,
  })
  const candidate = portfolio.generateSolver({ HIGH_DENSITY_A13: true })
  expect(candidate).toBeInstanceOf(HighDensitySolverA13)
  const a13 = candidate as unknown as HighDensitySolverA13
  while (a13.round === 0 && !a13.failed) a13.step()
  expect(a13.failed).toBe(false)
  expect(a13.routedCount).toBe(2)
  expect(a13.conflictCount).toBe(2)
  expect(a13.solved).toBe(false)
  expect(portfolio.computeH(candidate)).toBeGreaterThan(0)
  expect(portfolio.computeG(candidate)).toBe(a13.routingIterations / 1_000_000)
  expect(a13.props.maxSearchIterations).toBe(25_000_000)
  expect(a13.props.maxRounds).toBe(100)
  expect(a13.props.stepMultiplier).toBe(1000)
  expect(a13.traceThickness).toBe(0.15)
  expect(a13.viaDiameter).toBe(0.4)
})
