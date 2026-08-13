import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
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

test("the supervisor derives its limit without advancing candidates", () => {
  const solver = new PortfolioSingleIntraNodeSolver(solverParams)
  solver.initializeSolvers()

  const getA01Solvers = () =>
    solver.supervisedSolvers!.filter(
      ({ solver }) => solver.getSolverName() === "HighDensitySolverA01",
    )

  expect(getA01Solvers()).toHaveLength(1)
  expect(getA01Solvers()[0].solver.iterations).toBe(0)
  expect(solver.adaptiveSearchExpanded).toBe(false)
  expect(solver.MAX_ITERATIONS).toBe(
    solver.stats.dynamicSupervisorIterationLimit,
  )
  expect(solver.MAX_ITERATIONS).toBeGreaterThan(1)
})

test("the portfolio expands when every initial candidate is exhausted", () => {
  const solver = new PortfolioSingleIntraNodeSolver(solverParams)
  solver.initializeSolvers()
  for (const { solver: candidate } of solver.supervisedSolvers!) {
    candidate.failed = true
  }

  solver.step()

  const a01Solvers = solver.supervisedSolvers!.filter(
    ({ solver }) => solver.getSolverName() === "HighDensitySolverA01",
  )
  expect(solver.adaptiveSearchExpanded).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    a01Solvers.map(({ solver }) => (solver as any).hyperParameters.shuffleSeed),
  ).toEqual([0, 1, 2, 3, 4, 5])
  expect(solver.MAX_ITERATIONS).toBe(
    solver.stats.dynamicSupervisorIterationLimit,
  )
})

test("the portfolio expands after a dynamically sized exploration budget", () => {
  const solver = new PortfolioSingleIntraNodeSolver(solverParams)
  solver.initializeSolvers()
  const activeCandidate = solver.supervisedSolvers!.find(
    ({ solver }) => solver.getSolverName() === "HighDensitySolverA01",
  )!.solver
  for (const { solver: candidate } of solver.supervisedSolvers!) {
    if (candidate !== activeCandidate) candidate.failed = true
  }
  activeCandidate.iterations = solver.stats.dynamicExpansionWorkBudget
  ;(activeCandidate as any).step = () => {
    activeCandidate.iterations++
  }

  expect(solver.stats.dynamicExpansionWorkBudget).toBe(
    Math.max(
      ...solver.supervisedSolvers!.map(({ solver }) => solver.MAX_ITERATIONS),
    ),
  )

  solver.step()

  expect(solver.adaptiveSearchExpanded).toBe(true)
  expect(solver.stats.adaptiveSearchExpandedAtIteration).toBe(1)
  expect(solver.stats.dynamicExpansionWorkBudget).toBeGreaterThan(0)
})

test("an early solution does not expand the portfolio", () => {
  const solver = new PortfolioSingleIntraNodeSolver(solverParams)
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
  expect(solver.winningSolver!.adaptiveSearchExpanded).toBe(false)
  expect(solver.winningSolver!.stats.searchMode).toBe("priority")
  expect(
    (solver.winningSolver!.winningSolver as any).hyperParameters.shuffleSeed,
  ).toBe(2)
  expect(solver.stats.invalidGeometryFallback).not.toBe(true)
  expect(solver.winningSolver!.iterations).toBeLessThanOrEqual(
    solver.winningSolver!.MAX_ITERATIONS,
  )
  expect(solver.solvedRoutes).toHaveLength(19)
}, 60_000)
