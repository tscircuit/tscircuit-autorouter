import { expect, test } from "bun:test"
import { findCutGuidedOwnerRelease } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findCutGuidedOwnerRelease"

test("minimum owner count retains the global secondary distance obligation", (): void => {
  const graph = [
    [{ state: 3, distance: 1, owners: [0, 1] }, { state: 1, distance: 10, owners: [2] }, { state: 2, distance: 2, owners: [3] }],
    [{ state: 3, distance: 10, owners: [2] }],
    [{ state: 3, distance: 2, owners: [3] }],
    [],
  ]
  const actual = findCutGuidedOwnerRelease({ start: 0, getStateKey: (state: number): number => state, isGoal: (state: number): boolean => state === 3, getHops: (state: number) => graph[state]!, maxWorkUnits: 100_000 })
  expect(actual.result.found).toBe(true)
  if (!actual.result.found) throw new Error("Expected a certified path")
  expect([...actual.result.owners]).toEqual([3])
  expect(actual.result.distance).toBe(4)
  expect(actual.ownerMinimumProven && actual.distanceMinimumProven).toBe(true)
})
