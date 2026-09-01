import { expect, test } from "bun:test"
import {
  HighDensitySolverA11,
  HighDensitySolverA12,
} from "@tscircuit/high-density-a01"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import sample002Cmn279 from "../fixtures/srj18-sample002-cmn279.json"

test("native portfolios include A11 and A12 while grown portfolios stay coarse", () => {
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
    useHighDensitySolverA12: true,
  }
  const nativePortfolio = new PortfolioSingleIntraNodeSolver(solverParams)
  nativePortfolio.initializeSolvers()
  const a11Candidate = nativePortfolio.supervisedSolvers?.find(
    ({ solver: candidateSolver }) =>
      candidateSolver instanceof HighDensitySolverA11,
  )?.solver
  const a12Candidate = nativePortfolio.supervisedSolvers?.find(
    ({ solver: candidateSolver }) =>
      candidateSolver instanceof HighDensitySolverA12,
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
  expect(a12Candidate).toBeInstanceOf(HighDensitySolverA12)
  if (!(a12Candidate instanceof HighDensitySolverA12)) {
    throw new Error("Native portfolio did not create an A12 candidate")
  }
  expect(a12Candidate.MAX_ITERATIONS).toBe(15_000)
  expect(a12Candidate._setupDone).toBe(false)
  a12Candidate.step()
  expect(a12Candidate._setupDone).toBe(true)
  expect(a12Candidate.MAX_ITERATIONS).toBe(15_000)

  const standardPortfolio = new PortfolioSingleIntraNodeSolver({
    ...solverParams,
    useHighDensitySolverA11: false,
    useHighDensitySolverA12: false,
  })
  standardPortfolio.initializeSolvers()
  expect(
    standardPortfolio.supervisedSolvers?.some(
      ({ solver: candidateSolver }) =>
        candidateSolver instanceof HighDensitySolverA11 ||
        candidateSolver instanceof HighDensitySolverA12,
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
        candidateSolver.getSolverName() === "HighDensitySolverA11" ||
        candidateSolver.getSolverName() === "HighDensitySolverA12",
    ),
  ).toBe(false)
})
