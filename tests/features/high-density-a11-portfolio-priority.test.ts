import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { makeNode } from "./never-fail-growth-high-density/test-helpers"

test("native A11 and A12 are bounded behind the established portfolio", () => {
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

  const a11Candidate = solver.supervisedSolvers?.find(
    ({ solver: candidate }) =>
      candidate.getSolverName() === "HighDensitySolverA11",
  )
  const a01Candidate = solver.supervisedSolvers?.find(
    ({ hyperParameters }) =>
      hyperParameters.HIGH_DENSITY_A01 && hyperParameters.SHUFFLE_SEED === 0,
  )
  const a12Candidate = solver.supervisedSolvers?.find(
    ({ solver: candidate }) =>
      candidate.getSolverName() === "HighDensitySolverA12",
  )
  expect(a11Candidate?.solver.MAX_ITERATIONS).toBe(5_000)
  expect(a12Candidate?.solver.MAX_ITERATIONS).toBe(15_000)
  expect(a11Candidate?.f).toBeGreaterThan(a01Candidate?.f ?? Infinity)
  expect(a12Candidate?.f).toBeGreaterThan(a11Candidate?.f ?? Infinity)

  solver.step()
  expect(solver.activeSubSolver).not.toBe(a11Candidate?.solver)
  expect(solver.activeSubSolver).not.toBe(a12Candidate?.solver)
  expect(a11Candidate?.solver.iterations).toBe(0)
  expect(a12Candidate?.solver.iterations).toBe(0)

  solver.solved = false
  solver.failed = false
  solver.winningSolver = undefined
  for (const { solver: candidate } of solver.supervisedSolvers ?? []) {
    if (
      candidate !== a11Candidate?.solver &&
      candidate !== a12Candidate?.solver
    ) {
      candidate.solved = false
      candidate.failed = true
    }
  }
  solver.step()
  expect(a11Candidate?.solver.iterations).toBeGreaterThan(0)
  expect(a12Candidate?.solver.iterations).toBe(0)
})
