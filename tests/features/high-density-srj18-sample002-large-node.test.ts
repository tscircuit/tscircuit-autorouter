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

test("expanded search broadens the portfolio without batching one solver", () => {
  const ordinarySolver = new HyperSingleIntraNodeSolver(solverParams)
  ordinarySolver.initializeSolvers()
  const expandedSolver = new HyperSingleIntraNodeSolver({
    ...solverParams,
    expandedSearch: true,
  })
  expandedSolver.initializeSolvers()

  const ordinaryA01Solvers = ordinarySolver.supervisedSolvers!.filter(
    ({ solver }) => solver.getSolverName() === "HighDensitySolverA01",
  )
  const expandedA01Solvers = expandedSolver.supervisedSolvers!.filter(
    ({ solver }) => solver.getSolverName() === "HighDensitySolverA01",
  )

  expect(ordinaryA01Solvers).toHaveLength(1)
  expect(expandedA01Solvers).toHaveLength(4)
  expect(
    expandedA01Solvers.every(
      ({ solver }) => (solver as any).stepMultiplier === 1,
    ),
  ).toBe(true)
  expect(
    expandedSolver.supervisedSolvers!.some(
      ({ solver }) => solver.getSolverName() !== "HighDensitySolverA01",
    ),
  ).toBe(true)
})

test("the srj18 sample002 large node is solved at its physical size", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    ...solverParams,
    maxGrowthAttempts: 3,
    maxInnerIterationsPerGrowthAttempt: 8_000,
    fallbackToInvalidGeometryOnFailure: false,
    enableExpandedOriginalSizeSearch: true,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.growthAttempts).toBe(0)
  expect(solver.scaleFactor).toBe(1)
  expect(solver.expandedOriginalSizeSearchAttempted).toBe(true)
  expect(solver.stats.expandedOriginalSizeSearch).toBe(true)
  expect(solver.winningSolver?.expandedSearch).toBe(true)
  expect(solver.stats.invalidGeometryFallback).not.toBe(true)
  expect(solver.winningSolver?.iterations).toBeLessThanOrEqual(40_000)
  expect(solver.solvedRoutes).toHaveLength(19)
}, 10_000)
