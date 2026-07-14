import { expect, test } from "bun:test"
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

test("the supervisor derives its limit without advancing candidates", () => {
  const solver = new HyperSingleIntraNodeSolver(solverParams)
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

test("the portfolio expands only after every initial candidate is exhausted", () => {
  const solver = new HyperSingleIntraNodeSolver(solverParams)
  solver.initializeSolvers()
  for (const { solver: candidate } of solver.supervisedSolvers!) {
    candidate.failed = true
  }

  solver._step()

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
