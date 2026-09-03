import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { makeNode } from "./never-fail-growth-high-density/test-helpers"

test("native A11 and A12 share the established grid-solver priority", () => {
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
  expect(a11Candidate?.f).toBe(a01Candidate?.f)
  expect(a12Candidate?.f).toBe(a01Candidate?.f)

  solver.step()
  expect(solver.activeSubSolver).not.toBe(a11Candidate?.solver)
  expect(solver.activeSubSolver).not.toBe(a12Candidate?.solver)
  expect(a11Candidate?.solver.iterations).toBe(0)
  expect(a12Candidate?.solver.iterations).toBe(0)

  expect(solver.computeG(a11Candidate!.solver)).toBe(
    solver.computeG(a01Candidate!.solver),
  )
  expect(solver.computeG(a12Candidate!.solver)).toBe(
    solver.computeG(a01Candidate!.solver),
  )
})
