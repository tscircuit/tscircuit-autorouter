import { expect, test } from "bun:test"
import { findOwnerCutPath, type OwnerCutHop } from "lib/solvers/HighDensitySolver/findOwnerCutPath"

test("all incomplete oracle and master limits report UNKNOWN without invented cuts", (): void => {
  const graph: OwnerCutHop[][] = [[{ target: 1, owners: [0], distance: 1 }], []]
  const params = { start: 0, goal: 1, stateCount: 2,
    getHops: (state: number): OwnerCutHop[] => graph[state]!,
    getOwnerPrice: (_owner: number): number => 1 }
  const complete = findOwnerCutPath({ ...params, maxWorkUnits: 10_000 })
  expect(complete.status).toBe("found")
  expect(complete.work.learnedCuts).toBe(1)
  for (let cap = 0; cap < complete.work.units; cap++) {
    const limited = findOwnerCutPath({ ...params, maxWorkUnits: cap })
    expect(limited.status).toBe("unknown")
    expect(limited.work.units).toBeLessThanOrEqual(cap)
    if (limited.work.expandedStates === 0) expect(limited.work.learnedCuts).toBe(0)
  }
  for (const limits of [{ maxCuts: 0 }, { maxOwners: 0 }, { maxStoredHops: 0 }])
    expect(findOwnerCutPath({ ...params, maxWorkUnits: 10_000, ...limits }).status).toBe("unknown")
})
