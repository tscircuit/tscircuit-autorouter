import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { makeNode } from "./never-fail-growth-high-density/test-helpers"

test("native A11 and A12 share the established adaptive portfolio budget", () => {
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
  const establishedPortfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    obstacles: [],
    layerCount: 2,
    useHighDensitySolverA11: false,
    useHighDensitySolverA12: false,
  })

  solver.initializeSolvers()
  establishedPortfolio.initializeSolvers()

  expect(
    solver.supervisedSolvers?.some(
      ({ solver: candidate }) =>
        candidate.getSolverName() === "HighDensitySolverA11" ||
        candidate.getSolverName() === "HighDensitySolverA12",
    ),
  ).toBe(false)

  for (const portfolio of [solver, establishedPortfolio]) {
    for (const { solver: candidate } of portfolio.supervisedSolvers ?? []) {
      candidate.failed = true
    }
    portfolio.step()
  }

  expect(solver.adaptiveSearchExpanded).toBe(true)
  expect(solver.nativeExactGridCandidatesAdded).toBe(true)
  expect(solver.MAX_ITERATIONS).toBe(establishedPortfolio.MAX_ITERATIONS)

  const a11Candidate = solver.supervisedSolvers?.find(
    ({ solver: candidate }) =>
      candidate.getSolverName() === "HighDensitySolverA11",
  )
  const a01Candidate = solver.supervisedSolvers?.find(
    ({ hyperParameters }) =>
      hyperParameters.HIGH_DENSITY_A01 && hyperParameters.SHUFFLE_SEED === 1,
  )
  const a12Candidate = solver.supervisedSolvers?.find(
    ({ solver: candidate }) =>
      candidate.getSolverName() === "HighDensitySolverA12",
  )
  expect(a11Candidate?.g).toBe(0)
  expect(a11Candidate?.f).toBe(0)
  expect(a12Candidate?.g).toBe(0)
  expect(a12Candidate?.f).toBe(0)
  expect(a01Candidate?.solver.iterations).toBeGreaterThan(0)
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
