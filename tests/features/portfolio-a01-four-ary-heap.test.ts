import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("the A01 portfolio factory enables only the four-ary heap layout", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "four-ary-factory",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "signal", x: -1.5, y: -1.5, z: 0 },
      { connectionName: "signal", x: 1.5, y: 1.5, z: 0 },
    ],
  }
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: node,
    traceWidth: 0.15,
    viaDiameter: 0.3,
    effort: 0.5,
  })
  const actual: unknown = portfolio.generateSolver({
    HIGH_DENSITY_A01: true,
    SHUFFLE_SEED: 3,
  })
  if (!(actual instanceof HighDensitySolverA01)) {
    throw new Error("Expected the existing A01 candidate")
  }
  expect(actual.enableFourAryHeap).toBe(true)
  expect(actual.getConstructorParams()[0].enableFourAryHeap).toBe(true)
  expect(actual.effort).toBe(0.5)
  expect(actual.hyperParameters.shuffleSeed).toBe(3)
  const control = new HighDensitySolverA01({
    ...actual.getConstructorParams()[0],
    enableFourAryHeap: false,
  })
  actual.solve()
  control.solve()
  expect(actual.solved).toBe(true)
  expect(control.solved).toBe(true)
  expect(actual.iterations).toBe(control.iterations)
  expect(actual.MAX_ITERATIONS).toBe(control.MAX_ITERATIONS)
  expect(actual.getOutput()).toEqual(control.getOutput())
})
