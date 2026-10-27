import { expect, test } from "bun:test"
import { createRaceHarness } from "../fixtures/hdFamilyRace"

test("ordinary portfolio families resume after every A03 model exhausts its existing native budget", (): void => {
  const { solver, portfolios, created } = createRaceHarness({
    plans: {
      1: { completeAfter: Infinity, budget: 2 },
      2: { completeAfter: Infinity, budget: 2 },
      4: { completeAfter: Infinity, budget: 2 },
    },
    makeOtherBest: true,
    otherCompleteAfter: 2,
  })
  for (let i = 0; i < 6; i++) solver.step()
  expect(solver.solved).toBe(false)
  expect(created).toEqual([1, 2, 4])
  for (const portfolio of portfolios.values()) {
    expect(portfolio.native.iterations).toBe(2)
    expect(portfolio.native.MAX_ITERATIONS).toBe(2)
    expect(portfolio.native.failed).toBe(true)
    expect(portfolio.failed).toBe(false)
    expect(portfolio.other.iterations).toBe(0)
  }
  while (!solver.solved && !solver.failed && solver.iterations < 20)
    solver.step()
  expect(solver.solved).toBe(true)
  expect(solver.scaleFactor).toBe(1)
  expect(portfolios.get(1)!.other.iterations).toBe(2)
  expect(portfolios.get(1)!.winningSolver).toBe(portfolios.get(1)!.other)
  expect(portfolios.get(1)!.onSolveCalls).toBe(1)
  expect(solver.stats.scaleFamilyNativeIterations).toBe(6)
  expect(solver["scaleSearch"]).toBeUndefined()
})
