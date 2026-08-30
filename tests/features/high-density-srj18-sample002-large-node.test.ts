import { expect, test } from "bun:test"
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

test("high-density candidates are enabled by default and expand adaptively", () => {
  const solver = new PortfolioSingleIntraNodeSolver(solverParams)
  solver.initializeSolvers()

  const getNextA01Solvers = (): NonNullable<
    typeof solver.supervisedSolvers
  > =>
    solver.supervisedSolvers!.filter(
      ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01_NEXT,
    )

  expect(
    getNextA01Solvers().map(
      ({ solver }) => (solver as any).hyperParameters.shuffleSeed,
    ),
  ).toEqual([2, 5])
  expect(
    solver.supervisedSolvers!.filter(
      ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01,
    ),
  ).toHaveLength(1)
  expect(
    solver.supervisedSolvers!.some(
      ({ solver }) => solver.getSolverName() === "HighDensitySolverA08",
    ),
  ).toBe(true)
  expect(
    getNextA01Solvers().every(({ solver }) => solver.iterations === 0),
  ).toBe(true)
  expect(solver.adaptiveSearchExpanded).toBe(false)
  expect(solver.MAX_ITERATIONS).toBe(
    solver.stats.dynamicSupervisorIterationLimit,
  )
  expect(solver.MAX_ITERATIONS).toBeGreaterThan(1)

  for (const { solver: candidate } of solver.supervisedSolvers!) {
    candidate.failed = true
  }

  solver.step()

  expect(solver.adaptiveSearchExpanded).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    getNextA01Solvers().map(
      ({ solver }) => (solver as any).hyperParameters.shuffleSeed,
    ),
  ).toEqual([2, 5, 0, 1, 3, 4])
  expect(
    solver.supervisedSolvers!.filter(
      ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01,
    ),
  ).toHaveLength(6)
  expect(solver.MAX_ITERATIONS).toBe(
    solver.stats.dynamicSupervisorIterationLimit,
  )

  const twoPairNode = structuredClone(
    sample002LargeNode,
  ) as NodeWithPortPoints
  twoPairNode.portPointsInPairs = twoPairNode.portPointsInPairs!.slice(0, 2)
  twoPairNode.portPoints = twoPairNode.portPointsInPairs.flat()
  const twoPairSolver = new PortfolioSingleIntraNodeSolver({
    ...solverParams,
    nodeWithPortPoints: twoPairNode,
  })
  twoPairSolver.initializeSolvers()
  expect(
    twoPairSolver.supervisedSolvers!.some(
      ({ solver: candidate }) =>
        candidate.getSolverName() === "HighDensitySolverA08",
    ),
  ).toBe(true)
})
