import { expect, test } from "bun:test"
import { createRaceHarness } from "../fixtures/hdFamilyRace"

test("a rejected lower-scale refinement leaves the incumbent subject to the same acceptance validator", (): void => {
  let validations = 0
  const { solver, portfolios } = createRaceHarness({
    plans: {
      1: { completeAfter: Infinity, budget: 2 },
      2: { completeAfter: 3, budget: 5 },
      4: { completeAfter: 1, budget: 5 },
    },
    makeOtherBest: true,
    validator: (): boolean => {
      validations++
      return validations === 2
    },
  })
  while (!solver.solved && !solver.failed && solver.iterations < 30)
    solver.step()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(solver.scaleFactor).toBe(4)
  expect(validations).toBe(2)
  expect(portfolios.get(2)!.failed).toBe(true)
  expect(portfolios.get(2)!.error).toContain("rejected by validator")
  expect(solver.failedSolvers).toContain(portfolios.get(2)!)
  expect(solver.winningSolver).toBe(portfolios.get(4))
  expect(solver["scaleSearch"]).toBeUndefined()
})
