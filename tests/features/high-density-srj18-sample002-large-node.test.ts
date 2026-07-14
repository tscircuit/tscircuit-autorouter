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

test("the default portfolio expands in place and derives a dynamic budget", () => {
  const solver = new HyperSingleIntraNodeSolver(solverParams)
  solver.initializeSolvers()

  const getA01Solvers = () =>
    solver.supervisedSolvers!.filter(
      ({ solver }) => solver.getSolverName() === "HighDensitySolverA01",
    )

  expect(getA01Solvers()).toHaveLength(1)

  solver.iterations = 8_001
  solver._step()

  const a01Solvers = getA01Solvers()
  expect(solver.adaptiveSearchExpanded).toBe(true)
  expect(a01Solvers).toHaveLength(6)
  expect(
    a01Solvers.map(({ solver }) => (solver as any).hyperParameters.shuffleSeed),
  ).toEqual([0, 1, 2, 3, 4, 5])
  expect(
    solver.supervisedSolvers!.some(
      ({ solver }) => solver.getSolverName() !== "HighDensitySolverA01",
    ),
  ).toBe(true)
  expect(
    a01Solvers.every(({ solver }) => (solver as any).stepMultiplier === 1),
  ).toBe(true)
  expect(solver.MAX_ITERATIONS).toBe(
    solver.stats.dynamicSupervisorIterationLimit,
  )
  expect(solver.MAX_ITERATIONS).toBeGreaterThan(8_001)
})

test("an early solution does not expand the portfolio", () => {
  const solver = new HyperSingleIntraNodeSolver(solverParams)
  solver.initializeSolvers()
  const initialSolverCount = solver.supervisedSolvers!.length
  const immediateWinner = solver.supervisedSolvers!.find(
    ({ solver }) => solver.getSolverName() === "HighDensitySolverA01",
  )!
  immediateWinner.solver.solved = true
  ;(immediateWinner.solver as any).getOutput = () => []

  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.adaptiveSearchExpanded).toBe(false)
  expect(solver.supervisedSolvers).toHaveLength(initialSolverCount)
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
  expect(solver.winningSolver!.adaptiveSearchExpanded).toBe(true)
  expect(solver.stats.invalidGeometryFallback).not.toBe(true)
  expect(solver.winningSolver!.iterations).toBeLessThanOrEqual(
    solver.winningSolver!.MAX_ITERATIONS,
  )
  expect(solver.solvedRoutes).toHaveLength(19)
}, 10_000)
