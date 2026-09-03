import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { makeNode } from "./never-fail-growth-high-density/test-helpers"

const makePortfolio = (nodeWithPortPoints = makeNode()) => {
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints,
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
  return solver
}

const getNativeGridCandidates = (solver: PortfolioSingleIntraNodeSolver) => ({
  a01Candidate: solver.supervisedSolvers?.find(
    ({ hyperParameters }) =>
      hyperParameters.HIGH_DENSITY_A01 && hyperParameters.SHUFFLE_SEED === 0,
  ),
  a11Candidate: solver.supervisedSolvers?.find(
    ({ solver: candidate }) =>
      candidate.getSolverName() === "HighDensitySolverA11",
  ),
  a12Candidate: solver.supervisedSolvers?.find(
    ({ solver: candidate }) =>
      candidate.getSolverName() === "HighDensitySolverA12",
  ),
})

test("native A11 and A12 stay bounded and lazy on low-pressure nodes", () => {
  const solver = makePortfolio()
  const { a01Candidate, a11Candidate, a12Candidate } =
    getNativeGridCandidates(solver)

  expect(a11Candidate?.solver.MAX_ITERATIONS).toBe(5_000)
  expect(a12Candidate?.solver.MAX_ITERATIONS).toBe(15_000)
  expect(a11Candidate!.f).toBeGreaterThan(a01Candidate!.f)
  expect(a12Candidate!.f).toBeGreaterThan(a01Candidate!.f)

  solver.step()
  expect(solver.activeSubSolver).not.toBe(a11Candidate?.solver)
  expect(solver.activeSubSolver).not.toBe(a12Candidate?.solver)
  expect(a11Candidate?.solver.iterations).toBe(0)
  expect(a12Candidate?.solver.iterations).toBe(0)
})

test("native A11 and A12 share grid-solver priority on boundary-congested nodes", () => {
  const sparseNode = makeNode()
  const denseNode = {
    ...sparseNode,
    portPoints: Array.from({ length: 10 }, (_, index) => ({
      connectionName: `connection-${Math.floor(index / 2)}`,
      x: index % 2 === 0 ? 9.5 : 10.5,
      y: 20,
      z: 0,
    })),
  }
  const solver = makePortfolio(denseNode)
  const { a01Candidate, a11Candidate, a12Candidate } =
    getNativeGridCandidates(solver)

  expect(a11Candidate?.f).toBe(a01Candidate?.f)
  expect(a12Candidate?.f).toBe(a01Candidate?.f)
  expect(solver.computeG(a11Candidate!.solver)).toBe(
    solver.computeG(a01Candidate!.solver),
  )
  expect(solver.computeG(a12Candidate!.solver)).toBe(
    solver.computeG(a01Candidate!.solver),
  )
})
