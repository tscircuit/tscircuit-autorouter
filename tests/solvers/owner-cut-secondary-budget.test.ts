import { expect, test } from "bun:test"
import { findCutGuidedOwnerRelease } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findCutGuidedOwnerRelease"

test("a connected minimum-owner incumbent stays unknown until secondary distance is certified", (): void => {
  const graph = [
    [{ state: 3, distance: 1, owners: [0, 1] }, { state: 1, distance: 10, owners: [2] }, { state: 2, distance: 2, owners: [3] }],
    [{ state: 3, distance: 10, owners: [2] }], [{ state: 3, distance: 2, owners: [3] }], [],
  ]
  const options = { start: 0, getStateKey: (state: number): number => state, isGoal: (state: number): boolean => state === 3, getHops: (state: number) => graph[state]! }
  const exact = findCutGuidedOwnerRelease({ ...options, maxWorkUnits: 100_000 })
  expect(exact.result.found).toBe(true)
  let sawUnpublishedIncumbent = false
  for (let budget = 0; budget < exact.work.workUnits; budget++) {
    const capped = findCutGuidedOwnerRelease({ ...options, maxWorkUnits: budget })
    if (capped.work.connectedOwnerChoices > 0) sawUnpublishedIncumbent = true
    expect(capped.result.found).toBe(false)
    if (capped.result.found) throw new Error("A secondary-search cap is not proof")
    expect(capped.result.reason).toBe("expansion_limit")
  }
  expect(sawUnpublishedIncumbent).toBe(true)
})
