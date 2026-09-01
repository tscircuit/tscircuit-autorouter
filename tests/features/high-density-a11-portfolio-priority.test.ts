import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { makeNode } from "./never-fail-growth-high-density/test-helpers"

test("native portfolio gives established candidates priority over A11", () => {
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    obstacles: [],
    layerCount: 2,
    useHighDensitySolverA11: true,
  })

  solver.initializeSolvers()

  const a11Candidate = solver.supervisedSolvers?.find(
    ({ solver: candidate }) =>
      candidate.getSolverName() === "HighDensitySolverA11",
  )
  const a01Candidate = solver.supervisedSolvers?.find(
    ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01,
  )
  expect(a11Candidate?.g).toBe(solver.GREEDY_MULTIPLIER + 1)
  expect(a11Candidate?.f).toBe(solver.GREEDY_MULTIPLIER + 1)
  expect(a01Candidate?.g).toBe(0)
  expect(a01Candidate?.f).toBe(0)

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.winningSolver?.getSolverName()).not.toBe("HighDensitySolverA11")
  expect(a11Candidate?.solver.iterations).toBe(0)
})
