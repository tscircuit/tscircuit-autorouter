import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { createPhysicalPortfolioParams } from "./fixtures/createPhysicalPortfolioParams"

test("an exhausted physical-clearance portfolio fails without adding legacy external candidates", (): void => {
  const solver = new PortfolioSingleIntraNodeSolver(
    createPhysicalPortfolioParams(),
  )
  solver.initializeSolvers()
  const candidates = [...solver.supervisedSolvers!]
  for (const candidate of candidates) {
    candidate.solver.failed = true
    candidate.solver.error = "fixture candidate exhausted"
  }
  solver.step()
  expect(solver.failed).toBeTrue()
  expect(solver.solved).toBeFalse()
  expect(solver.error).toContain("fixture candidate exhausted")
  expect(solver.adaptiveSearchExpanded).toBeFalse()
  expect(solver.stats.adaptiveSearchExpanded).toBeUndefined()
  expect(solver.supervisedSolvers).toHaveLength(63)
  expect(solver.supervisedSolvers).toEqual(candidates)
  expect(solver.winningSolver).toBeUndefined()
})
