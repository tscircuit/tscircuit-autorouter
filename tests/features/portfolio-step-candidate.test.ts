import { expect, spyOn, test } from "bun:test"
import { createRaceHarness } from "../fixtures/hdFamilyRace"

test("explicit portfolio advancement preserves candidate budgets and restores ordinary selection after errors", (): void => {
  const { solver, portfolios } = createRaceHarness({
    plans: {
      1: { completeAfter: Infinity, budget: 3, throwAt: 3 },
      2: { completeAfter: 10, budget: 20 },
      4: { completeAfter: 10, budget: 20 },
    },
    makeOtherBest: true,
  })
  solver.step()
  const portfolio = portfolios.get(1)!
  const candidate = portfolio.supervisedSolvers![0]!
  const other = portfolio.supervisedSolvers![1]!
  expect(portfolio.getSupervisedSolverWithBestFitness()).toBe(other)
  expect(() => portfolio.stepCandidate({ ...candidate })).toThrow("foreign")
  portfolio.stepCandidate(candidate)
  expect(portfolio.native.iterations).toBe(2)
  expect(portfolio.native.MAX_ITERATIONS).toBe(3)
  expect(portfolio.other.iterations).toBe(0)
  expect(portfolio.iterations).toBe(2)
  const logging = spyOn(console, "error").mockImplementation((): void => {})
  try {
    expect(() => portfolio.stepCandidate(candidate)).toThrow("scripted A03 failure")
  } finally {
    logging.mockRestore()
  }
  expect(portfolio.failed).toBe(true)
  expect(portfolio["candidateToAdvance"]).toBeUndefined()
  expect(portfolio.getSupervisedSolverWithBestFitness()).toBe(other)
  expect(() => portfolio.stepCandidate(candidate)).toThrow("inactive")
  expect(portfolio.other.iterations).toBe(0)
})
