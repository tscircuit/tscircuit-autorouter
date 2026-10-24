import { expect, test } from "bun:test"
import type { DistinctOwnerBlockerHop } from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"
import { findFeasibleOwnerCorridor, FEASIBLE_OWNER_WORK_LIMIT, FEASIBLE_OWNER_LABEL_LIMIT } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findFeasibleOwnerCorridor"

test("the generator and refinement share finite caps and incomplete stages never become successful or impossible", (): void => {
  type Hop = DistinctOwnerBlockerHop<number, number, unknown>
  const graph: Hop[][] = [[{ state: 1, owners: [0], distance: 1 }], [{ state: 2, owners: [0, 1], distance: 1 }], []]
  const options = { start: 0, getStateKey: (state: number): number => state,
    isGoal: (state: number): boolean => state === 2, getHops: (state: number): Hop[] => graph[state]!,
    getOwnerWork: (): number => 1, getGoalDistance: (): number => 0, distanceScale: 2, maxExpandedLabels: 100 }
  const complete = findFeasibleOwnerCorridor(options)
  expect(complete.result.found).toBe(true)
  for (let cap = 0; cap <= complete.work.workUnits; cap++) {
    const answer = findFeasibleOwnerCorridor({ ...options, maxWorkUnits: cap })
    expect(answer.work.workUnits).toBeLessThanOrEqual(cap)
    if (cap === complete.work.workUnits) expect(answer.result.found).toBe(true)
    else {
      expect(answer.result.found).toBe(false)
      if (answer.result.found) throw new Error("Budget prefix manufactured a route")
      expect(answer.result.reason).toBe("expansion_limit")
      expect(answer.chosenSetDistanceMinimumProven).toBe(false)
    }
  }
  const shared = findFeasibleOwnerCorridor({ ...options, maxExpandedLabels: 3 })
  expect(shared.result.found).toBe(false)
  if (shared.result.found) throw new Error("Shared cap was reset between generators")
  expect(shared.result.reason).toBe("expansion_limit")
  expect(shared.result.expandedLabelCount).toBe(3)
  expect(shared.work.generatorCalls).toBe(1)
  expect(shared.work.refinementCalls).toBe(1)
  for (const cap of [0, 1, 5]) {
    const answer = findFeasibleOwnerCorridor({ ...options, maximumStoredLabels: cap })
    expect(answer.result.found).toBe(false)
    expect(answer.work.storageLimitHits).toBe(1)
  }
  expect(() => findFeasibleOwnerCorridor({ ...options, maxWorkUnits: FEASIBLE_OWNER_WORK_LIMIT + 1 })).toThrow("fixed policy")
  expect(() => findFeasibleOwnerCorridor({ ...options, maximumStoredLabels: FEASIBLE_OWNER_LABEL_LIMIT + 1 })).toThrow("fixed policy")
  expect(() => findFeasibleOwnerCorridor({ ...options, getOwnerWork: (): number => -1 })).toThrow("nonnegative")
  expect(() => findFeasibleOwnerCorridor({ ...options, getHops: (): Hop[] => [{ state: 2, distance: NaN }] })).toThrow("finite nonnegative")
  expect(() => findFeasibleOwnerCorridor({ ...options, getHops: (): undefined => undefined })).toThrow("without a charged budget stop")
})
