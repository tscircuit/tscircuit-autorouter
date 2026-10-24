import { expect, test } from "bun:test"
import { findLazyMinimumOwnerRelease } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findLazyMinimumOwnerRelease"

test("baseline gates preserve conjunctions and all exits through nonmonotone owner trials", (): void => {
  const graph = [
    [{ state: 1, owners: [], distance: 0 }, { state: 2, owners: [10], distance: 2 },
      { state: 4, owners: [20], distance: 1 }, { state: 5, owners: [30, 40], distance: 1 }],
    [{ state: 2, owners: [10], distance: 2 }, { state: 2, owners: [10], distance: 2 }],
    [{ state: 4, owners: [], distance: 0 }],
    [],
    [{ state: 6, owners: [20], distance: 1 }],
    [{ state: 6, owners: [], distance: 1 }],
    [],
  ]
  const reads = new Map<number, number>()
  const result = findLazyMinimumOwnerRelease({ start: 0, getStateKey: (state: number): number => state,
    isGoal: (state: number): boolean => state === 6,
    getHops: (state: number) => { reads.set(state, (reads.get(state) ?? 0) + 1); return graph[state]! }, maxWorkUnits: 10000 })
  expect(result.result.found).toBe(true)
  if (!result.result.found) throw new Error("Alternative baseline owner20 must remain available")
  expect([...result.result.owners]).toEqual([20])
  expect(result.result.distance).toBe(2)
  expect(result.work.initialFreeStates).toBe(2)
  expect(result.work.initialFreeHopVisits).toBe(6)
  expect(result.work.initialBlockedOccurrences).toBe(5)
  expect(result.work.baselineOwnerTerms).toBe(3)
  expect(result.work.baselineGateTargets).toBe(3)
  expect(result.work.trialCalls).toBe(2)
  expect(result.work.learnedCuts).toBe(2)
  expect(reads.get(0)).toBe(1)
  expect(reads.get(1)).toBe(1)
  // A reached destination of a previously blocked baseline gate is removed
  // during cut extraction; source0/1 free interiors are never rescanned.
  expect(result.work.cutTargetReads).toBeGreaterThan(0)
  expect(result.work.trialExpandedStates).toBeLessThan(7)
})
