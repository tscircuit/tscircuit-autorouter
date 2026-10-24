import { expect, test } from "bun:test"
import { findCutGuidedOwnerRelease } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findCutGuidedOwnerRelease"

test("capped owner master never reports a feasible incumbent or finite-model impossibility as proven", (): void => {
  for (const budget of [0, 1, 2, 3, 4, 5]) {
    const result = findCutGuidedOwnerRelease({ start: 0, getStateKey: (state: number): number => state, isGoal: (state: number): boolean => state === 2, getHops: (state: number) => state < 2 ? [{ state: state + 1, distance: 1, owners: [state] }] : [], maxWorkUnits: budget })
    expect(result.result.found).toBe(false)
    if (result.result.found) throw new Error("Budget cannot certify this query")
    expect(result.result.reason).toBe("expansion_limit")
    expect(result.ownerMinimumProven || result.distanceMinimumProven).toBe(false)
    expect(result.work.workUnits).toBeLessThanOrEqual(budget)
  }
})
