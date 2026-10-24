import { expect, test } from "bun:test"
import { findLazyMinimumOwnerRelease } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findLazyMinimumOwnerRelease"

test("zero owner goal still pays shortest path and every finite cap yields explicit unknown", (): void => {
  const free = [[{ state: 1, distance: 0, owners: [] }, { state: 2, distance: 10, owners: [] }],
    [{ state: 2, distance: 1, owners: [] }], []]
  const call = (maxWorkUnits: number) => findLazyMinimumOwnerRelease({ start: 0,
    getStateKey: (state: number): number => state, isGoal: (state: number): boolean => state === 2,
    getHops: (state: number) => free[state]!, maxWorkUnits })
  const exact = call(1000)
  expect(exact.result.found).toBe(true)
  if (!exact.result.found) throw new Error("Free controlled path must connect")
  expect(exact.result.distance).toBe(1)
  expect(exact.result.owners.size).toBe(0)
  expect(exact.work.shortestHopVisits).toBe(3)
  for (let cap = 0; cap < exact.work.workUnits; cap++) {
    const limited = call(cap)
    expect(limited.result.found).toBe(false)
    if (limited.result.found) throw new Error("Insufficient cap cannot certify full shortest refinement")
    expect(limited.result.reason).toBe("expansion_limit")
    expect(limited.work.workUnits).toBeLessThanOrEqual(cap)
    expect(limited.ownerMinimumProven).toBe(false)
    expect(limited.chosenSetDistanceMinimumProven).toBe(false)
  }
  expect(() => call(-1)).toThrow()
  const changed = call(1000)
  expect(changed.result).toEqual(exact.result)
})
