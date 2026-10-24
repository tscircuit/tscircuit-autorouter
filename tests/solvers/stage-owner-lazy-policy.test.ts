import { expect, test } from "bun:test"
import { findLazyMinimumOwnerRelease } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findLazyMinimumOwnerRelease"
import { findDistinctOwnerBlockerPath, orderRoutesAfterSelectiveRerip, selectOwnerRouteIdsToRip } from "tiny-hypergraph/lib/index"

test("first connected minimum owner policy explicitly differs from global distance tie", (): void => {
  const graph = [[{ state: 1, owners: [11], distance: 100 }, { state: 1, owners: [22], distance: 1 }], []]
  const result = findLazyMinimumOwnerRelease({ start: 0, getStateKey: (state: number): number => state,
    isGoal: (state: number): boolean => state === 1, getHops: (state: number) => graph[state]!, maxWorkUnits: 1000 })
  expect(result.result.found).toBe(true)
  if (!result.result.found) throw new Error("Controlled first owner must connect")
  expect([...result.result.owners]).toEqual([11])
  expect(result.result.distance).toBe(100)
  expect(result.ownerMinimumProven).toBe(true)
  expect(result.chosenSetDistanceMinimumProven).toBe(true)
  expect(result.globalDistanceMinimumProven).toBe(false)
  expect(result.work.trialCalls).toBe(1)
  expect(result.provisionalMinimumOwnerCount).toBe(1)
  const chain = [[{ state: 1, owners: [11], distance: 1 }], [{ state: 2, owners: [22, 11], distance: 1 }], []]
  const options = { start: 0, getStateKey: (state: number): number => state,
    isGoal: (state: number): boolean => state === 2, getHops: (state: number) => chain[state]! }
  const original = findDistinctOwnerBlockerPath({ ...options, maxExpandedLabels: 1000 })
  const corrected = findLazyMinimumOwnerRelease({ ...options, maxWorkUnits: 10000 })
  expect(original.found && corrected.result.found).toBe(true)
  if (!original.found || !corrected.result.found) throw new Error("Controlled ordered owner witness must connect")
  expect(corrected.result.states).toEqual(original.states)
  expect(corrected.result.hops).toEqual(original.hops)
  expect([...corrected.result.owners]).toEqual([11, 22])
  expect([...corrected.result.owners]).toEqual([...original.owners])
  const rippedRouteIds = selectOwnerRouteIdsToRip({ failedRouteId: 99, directOwnerRouteIds: [...corrected.result.owners] })
  expect(orderRoutesAfterSelectiveRerip({ failedRouteId: 99, pendingRouteIds: [77], rippedRouteIds })).toEqual([99, 77, 11, 22])
})
