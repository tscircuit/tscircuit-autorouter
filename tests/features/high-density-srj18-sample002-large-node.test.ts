import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { HyperSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample002LargeNode from "../fixtures/srj18-sample002-large-node.json"

const solverParams = {
  nodeWithPortPoints: sample002LargeNode as NodeWithPortPoints,
  viaDiameter: 0.3,
  traceWidth: 0.1,
  obstacleMargin: 0.15,
  obstacles: [],
  layerCount: 2,
  effort: 1,
}

test("the default portfolio derives its budget from deterministic candidates", () => {
  const solver = new HyperSingleIntraNodeSolver(solverParams)
  solver.initializeSolvers()

  const a01Solvers = solver.supervisedSolvers!.filter(
    ({ solver }) => solver.getSolverName() === "HighDensitySolverA01",
  )

  expect(a01Solvers).toHaveLength(6)
  expect(
    a01Solvers.map(
      ({ solver }) => (solver as any).hyperParameters.shuffleSeed,
    ),
  ).toEqual([0, 1, 2, 3, 4, 5])
  expect(
    a01Solvers.every(
      ({ solver }) => (solver as any).stepMultiplier === 1,
    ),
  ).toBe(true)
  expect(solver.MAX_ITERATIONS).toBe(
    solver.stats.dynamicSupervisorIterationBudget,
  )
  expect(solver.MAX_ITERATIONS).toBeGreaterThan(8_000)
})

test("the srj18 sample002 large node is solved at its physical size", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    ...solverParams,
    maxGrowthAttempts: 3,
    fallbackToInvalidGeometryOnFailure: false,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.growthAttempts).toBe(0)
  expect(solver.scaleFactor).toBe(1)
  expect(solver.stats.invalidGeometryFallback).not.toBe(true)
  expect(solver.winningSolver!.iterations).toBeLessThanOrEqual(
    solver.winningSolver!.MAX_ITERATIONS,
  )
  expect(solver.solvedRoutes).toHaveLength(19)
}, 10_000)
