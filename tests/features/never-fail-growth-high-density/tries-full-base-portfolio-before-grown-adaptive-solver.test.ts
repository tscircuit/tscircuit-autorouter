import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { makeNode } from "./test-helpers"

test("tries the full base portfolio before preferring A01 at a grown scale", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    maxGrowthAttempts: 2,
    usePrimaryAdaptiveOnlyAtIntermediateScales: true,
  })
  const basePortfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
  })
  solver.activeSubSolver = basePortfolio

  basePortfolio.initializeSolvers()
  for (const candidate of basePortfolio.supervisedSolvers!) {
    candidate.solver.failed = true
  }
  basePortfolio.step()
  expect(basePortfolio.adaptiveSearchExpanded).toBe(true)

  for (const candidate of basePortfolio.supervisedSolvers!) {
    candidate.solver.failed = true
  }
  basePortfolio.solved = false
  basePortfolio.winningSolver = undefined
  basePortfolio.failed = true
  solver.step()

  expect(solver.scaleFactor).toBe(2)
  expect(solver.growthAttempts).toBe(1)

  const grownPortfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    preferPrimaryAdaptiveSolver: true,
    failAfterPrimaryAdaptiveSolver: true,
  })
  grownPortfolio.step()
  expect(grownPortfolio.preferPrimaryAdaptiveSolver).toBe(true)
  expect(grownPortfolio.primaryAdaptiveSolver).toBeDefined()
  expect(grownPortfolio.supervisedSolvers).toBeUndefined()

  grownPortfolio.solved = false
  grownPortfolio.winningSolver = undefined
  grownPortfolio.primaryAdaptiveSolver!.solved = false
  grownPortfolio.primaryAdaptiveSolver!.failed = true
  grownPortfolio.step()

  expect(grownPortfolio.primaryAdaptiveSolverFinished).toBe(true)
  expect(grownPortfolio.failed).toBe(true)
  expect(grownPortfolio.supervisedSolvers).toBeUndefined()
})
