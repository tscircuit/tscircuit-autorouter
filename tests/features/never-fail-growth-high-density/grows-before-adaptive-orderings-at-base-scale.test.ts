import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { makeNode } from "./test-helpers"

test("GrowShrinkHighDensityIntraNodeSolver grows after the full bounded base-scale portfolio", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    maxGrowthAttempts: 1,
  })

  const baseScalePortfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    lateAdaptiveOrderingIterationLimit: 500_000,
  })
  solver.activeSubSolver = baseScalePortfolio
  baseScalePortfolio.initializeSolvers()
  for (const {
    solver: candidateSolver,
  } of baseScalePortfolio.supervisedSolvers!) {
    candidateSolver.solved = false
    candidateSolver.failed = true
    candidateSolver.error = "forced initial portfolio exhaustion"
  }

  baseScalePortfolio.step()

  expect(baseScalePortfolio.adaptiveSearchExpanded).toBe(true)
  expect(
    baseScalePortfolio.supervisedSolvers
      ?.filter(
        ({ solver: candidateSolver }) =>
          candidateSolver.getSolverName() === "HighDensitySolverA01",
      )
      .map(
        ({ solver: candidateSolver }) =>
          candidateSolver.hyperParameters.shuffleSeed,
      ),
  ).toEqual([0, 1, 2, 3, 4, 5])
  expect(
    baseScalePortfolio.supervisedSolvers
      ?.filter(
        ({ solver: candidateSolver }) =>
          candidateSolver.getSolverName() === "HighDensitySolverA01" &&
          candidateSolver.hyperParameters.shuffleSeed >= 4,
      )
      .every(
        ({ solver: candidateSolver }) =>
          candidateSolver.MAX_ITERATIONS === 500_000,
      ),
  ).toBe(true)

  baseScalePortfolio.solved = false
  baseScalePortfolio.failed = false
  baseScalePortfolio.winningSolver = undefined
  for (const {
    solver: candidateSolver,
  } of baseScalePortfolio.supervisedSolvers!) {
    candidateSolver.solved = false
    candidateSolver.failed = true
    candidateSolver.error = "forced adaptive portfolio exhaustion"
  }
  solver.step()

  expect(solver.growthAttempts).toBe(1)
  expect(solver.scaleFactor).toBe(2)
})
