import { expect, test } from "bun:test"
import { createRaceHarness } from "../fixtures/hdFamilyRace"

test("scale racing opens a later wave only after all current portfolios exhaust their original candidate budgets", (): void => {
  const { solver, portfolios, created } = createRaceHarness({
    plans: {
      1: { completeAfter: Infinity, budget: 2 },
      2: { completeAfter: Infinity, budget: 2 },
      4: { completeAfter: Infinity, budget: 2 },
      8: { completeAfter: 1, budget: 2 },
    },
  })
  for (let i = 0; i < 18; i++) solver.step()
  expect(created).toEqual([1, 2, 4])
  expect(solver.failedSolvers).toHaveLength(3)
  for (const portfolio of portfolios.values()) {
    expect(portfolio.native.MAX_ITERATIONS).toBe(2)
    expect(portfolio.native.iterations).toBe(2)
    expect(portfolio.native.failed).toBe(true)
    expect(portfolio.other.MAX_ITERATIONS).toBe(2)
    expect(portfolio.other.iterations).toBe(3)
    expect(portfolio.failed).toBe(true)
  }
  solver.step()
  expect(created).toEqual([1, 2, 4, 8])
  expect(solver.solved).toBe(true)
  expect(solver.scaleFactor).toBe(8)
  expect(solver.stats.scaleSearchCandidateCount).toBe(4)
  expect(solver["scaleSearch"]).toBeUndefined()
})
