import { expect, test } from "bun:test"
import { findCutGuidedOwnerRelease } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findCutGuidedOwnerRelease"

test("a directed crossing needs every owner while a repeated owner is charged once", (): void => {
  const graph = [
    [{ state: 3, distance: 1, owners: [0, 1] }, { state: 1, distance: 2, owners: [2, 2] }],
    [{ state: 3, distance: 2, owners: [2] }],
    [{ state: 0, distance: 0, owners: [] }],
    [],
  ]
  const options = { start: 0, getStateKey: (state: number): number => state, isGoal: (state: number): boolean => state === 3, getHops: (state: number) => graph[state]!, maxWorkUnits: 10_000 }
  const actual = findCutGuidedOwnerRelease(options)
  expect(actual.result.found).toBe(true)
  if (!actual.result.found) throw new Error("Expected one distinct owner")
  expect([...actual.result.owners]).toEqual([2])
  expect(actual.result.distance).toBe(4)
  const backwards = findCutGuidedOwnerRelease({ ...options, start: 3, isGoal: (state: number): boolean => state === 0 })
  expect(backwards.result.found).toBe(false)
  if (backwards.result.found) throw new Error("Reverse directed path does not exist")
  expect(backwards.result.reason).toBe("no_path")
})
