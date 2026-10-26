import { expect, test } from "bun:test"
import { createRaceHarness, raceNode } from "../fixtures/hdFamilyRace"

test("a scale-one success needs only one bounded wave even with an unbounded attempt limit", (): void => {
  for (const maxGrowthAttempts of [100_000, Infinity]) {
    const { solver, portfolios, created } = createRaceHarness({
      plans: {
        1: { completeAfter: 1, budget: 5 },
        2: { completeAfter: Infinity, budget: 5 },
        4: { completeAfter: Infinity, budget: 5 },
      },
      params: { maxGrowthAttempts },
    })
    solver.step()
    expect(solver.solved).toBe(true)
    expect(solver.scaleFactor).toBe(1)
    expect(created).toEqual([1, 2, 4])
    expect(portfolios.get(2)!.native.iterations).toBe(0)
    expect(portfolios.get(4)!.native.iterations).toBe(0)
    expect(solver.stats.scaleSearchCandidateCount).toBe(3)
  }
  const narrow = structuredClone(raceNode)
  narrow.width = 0.08
  for (const point of narrow.portPoints) point.x = Math.sign(point.x) * 0.04
  const { solver, created } = createRaceHarness({
    plans: {
      1: { completeAfter: 1, budget: 5 },
      4: { completeAfter: Infinity, budget: 5 },
      8: { completeAfter: Infinity, budget: 5 },
    },
    params: { nodeWithPortPoints: narrow, maxGrowthAttempts: 4 },
  })
  solver.step()
  expect(solver.minimumGrowthAttempts).toBe(2)
  expect(created).toEqual([1, 4, 8])
  expect(solver.solved).toBe(true)
})
