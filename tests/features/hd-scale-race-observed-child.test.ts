import { expect, test } from "bun:test"
import {
  createRaceHarness,
  type ScriptedPortfolio,
} from "../fixtures/hdFamilyRace"

test("scale refinement observes an already-solved native child through portfolio onSolve and validation", (): void => {
  let lower: ScriptedPortfolio | undefined
  let validations = 0
  const { solver, portfolios } = createRaceHarness({
    plans: {
      1: { completeAfter: Infinity, budget: 5 },
      2: { completeAfter: Infinity, budget: 5 },
      4: { completeAfter: 1, budget: 5 },
    },
    onStep: (scale, portfolio): void => {
      if (scale === 1) lower = portfolio
      if (scale === 4 && portfolio.solved) {
        lower!.native.solved = true
        expect(lower!.solved).toBe(false)
      }
    },
    validator: (routes): boolean => {
      validations++
      return routes.every((route) =>
        route.rootConnectionName?.startsWith("net"),
      )
    },
  })
  while (!solver.solved && !solver.failed && solver.iterations < 20)
    solver.step()
  expect(solver.solved).toBe(true)
  expect(solver.scaleFactor).toBe(1)
  expect(portfolios.get(1)!.native.iterations).toBe(1)
  expect(portfolios.get(1)!.onSolveCalls).toBe(1)
  expect(portfolios.get(1)!.solvedRoutes).toHaveLength(8)
  expect(validations).toBe(1)
})
