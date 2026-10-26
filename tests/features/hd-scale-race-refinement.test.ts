import { expect, test } from "bun:test"
import { createRaceHarness } from "../fixtures/hdFamilyRace"

test("scale racing refines the successful family at smaller scales without advancing other families", (): void => {
  let validations = 0
  const { solver, portfolios, created } = createRaceHarness({
    plans: {
      1: { completeAfter: Infinity, budget: 2 },
      2: { completeAfter: 3, budget: 5 },
      4: { completeAfter: 1, budget: 5 },
    },
    makeOtherBest: true,
    validator: (routes): boolean => {
      validations++
      return routes.length === 8
    },
  })
  while (!solver.solved && !solver.failed && solver.iterations < 30)
    solver.step()
  expect(solver.solved).toBe(true)
  expect(solver.scaleFactor).toBe(2)
  expect(created).toEqual([1, 2, 4])
  expect(validations).toBe(1)
  expect(portfolios.get(1)!.native.iterations).toBe(2)
  expect(portfolios.get(2)!.native.iterations).toBe(3)
  expect(portfolios.get(4)!.native.iterations).toBe(1)
  expect(portfolios.get(1)!.native.MAX_ITERATIONS).toBe(2)
  expect(portfolios.get(2)!.native.MAX_ITERATIONS).toBe(5)
  expect(
    [...portfolios.values()].map((portfolio) => portfolio.other.iterations),
  ).toEqual([0, 0, 0])
  expect(portfolios.get(2)!.onSolveCalls).toBe(1)
  expect(solver.solvedRoutes[0]!.route[0]!.x).toBe(-5)
  expect(solver.stats.scaleRefinementNativeIterations).toBe(3)
  expect(solver.activeSubSolver).toBeNull()
  expect(solver["scaleSearch"]).toBeUndefined()
})
