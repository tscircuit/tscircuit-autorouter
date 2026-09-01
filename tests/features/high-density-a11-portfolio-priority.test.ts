import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { makeNode } from "./never-fail-growth-high-density/test-helpers"

test("native portfolio adds A11 and A12 after established candidates exhaust", () => {
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    obstacles: [],
    layerCount: 2,
    useHighDensitySolverA11: true,
    useHighDensitySolverA12: true,
  })

  solver.initializeSolvers()

  expect(
    solver.supervisedSolvers?.some(
      ({ solver: candidate }) =>
        candidate.getSolverName() === "HighDensitySolverA11" ||
        candidate.getSolverName() === "HighDensitySolverA12",
    ),
  ).toBe(false)

  for (const { solver: candidate } of solver.supervisedSolvers ?? []) {
    candidate.failed = true
  }
  solver.step()
  expect(solver.adaptiveSearchExpanded).toBe(true)
  expect(solver.nativeExactGridCandidatesAdded).toBe(false)

  solver.solved = false
  solver.failed = false
  solver.winningSolver = undefined
  for (const { solver: candidate } of solver.supervisedSolvers ?? []) {
    candidate.solved = false
    candidate.failed = true
  }
  solver.step()

  const a11Candidate = solver.supervisedSolvers?.find(
    ({ solver: candidate }) =>
      candidate.getSolverName() === "HighDensitySolverA11",
  )
  const a01Candidate = solver.supervisedSolvers?.find(
    ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01,
  )
  const a12Candidate = solver.supervisedSolvers?.find(
    ({ solver: candidate }) =>
      candidate.getSolverName() === "HighDensitySolverA12",
  )
  expect(a11Candidate?.g).toBe(solver.GREEDY_MULTIPLIER + 1)
  expect(a11Candidate?.f).toBe(solver.GREEDY_MULTIPLIER + 1)
  expect(a12Candidate?.g).toBe(solver.GREEDY_MULTIPLIER + 2)
  expect(a12Candidate?.f).toBe(solver.GREEDY_MULTIPLIER + 2)
  expect(a01Candidate?.g).toBe(0)
  expect(a01Candidate?.f).toBe(0)
  expect(solver.nativeExactGridCandidatesAdded).toBe(true)
  expect(a11Candidate?.solver.iterations).toBe(0)
  expect(a12Candidate?.solver.iterations).toBe(0)

  solver.step()
  expect(a11Candidate?.solver.iterations).toBeGreaterThan(0)
  expect(a12Candidate?.solver.iterations).toBe(0)
})
