import { expect, test } from "bun:test"
import { HighDensitySolverA11 } from "@tscircuit/high-density-a01"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample002Cmn279 from "../fixtures/srj18-sample002-cmn279.json"

test("native portfolios include A11 while grown portfolios stay coarse", () => {
  const nodeWithPortPoints = sample002Cmn279 as NodeWithPortPoints
  const solverParams = {
    nodeWithPortPoints,
    connMap: new ConnectivityMap({}),
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    obstacles: [],
    layerCount: 2,
    useHighDensitySolverA11: true,
  }
  const nativePortfolio = new PortfolioSingleIntraNodeSolver(solverParams)
  nativePortfolio.initializeSolvers()
  const a11Candidate = nativePortfolio.supervisedSolvers?.find(
    ({ solver: candidateSolver }) =>
      candidateSolver instanceof HighDensitySolverA11,
  )?.solver

  expect(a11Candidate).toBeInstanceOf(HighDensitySolverA11)
  if (!(a11Candidate instanceof HighDensitySolverA11)) {
    throw new Error("Native portfolio did not create an A11 candidate")
  }
  expect(a11Candidate.MAX_ITERATIONS).toBe(5_000)
  expect(a11Candidate.rows).toBeUndefined()
  a11Candidate.step()
  expect(a11Candidate.rows).toBeDefined()
  expect(a11Candidate.MAX_ITERATIONS).toBe(5_000)

  const standardPortfolio = new PortfolioSingleIntraNodeSolver({
    ...solverParams,
    useHighDensitySolverA11: false,
  })
  standardPortfolio.initializeSolvers()
  expect(
    standardPortfolio.supervisedSolvers?.some(
      ({ solver: candidateSolver }) =>
        candidateSolver instanceof HighDensitySolverA11,
    ),
  ).toBe(false)

  const grownSolver = new GrowShrinkHighDensityIntraNodeSolver(solverParams)
  grownSolver.scaleFactor = 2
  grownSolver.step()

  expect(grownSolver.activeSubSolver).toBeInstanceOf(
    PortfolioSingleIntraNodeSolver,
  )
  expect(
    grownSolver.activeSubSolver?.supervisedSolvers?.some(
      ({ solver: candidateSolver }) =>
        candidateSolver.getSolverName() === "HighDensitySolverA11",
    ),
  ).toBe(false)
})
