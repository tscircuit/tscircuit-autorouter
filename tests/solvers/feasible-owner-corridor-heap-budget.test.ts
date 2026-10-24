import { expect, test } from "bun:test"
import type { DistinctOwnerBlockerHop } from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"
import { findFeasibleOwnerCorridor } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findFeasibleOwnerCorridor"

test("every heap-comparison budget prefix stops before uncharged sift work and arbitrary callback errors propagate", (): void => {
  type Hop = DistinctOwnerBlockerHop<number, number, unknown>
  const graph: Hop[][] = Array.from({ length: 10 }, (): Hop[] => [])
  for (let i = 1; i <= 8; i++) {
    graph[0]!.push({ state: i, owners: [i % 3], distance: 10 - i })
    graph[i]!.push({ state: 9, owners: [], distance: i })
  }
  const options = { start: 0, getStateKey: (state: number): number => state,
    isGoal: (state: number): boolean => state === 9, getHops: (state: number): Hop[] => graph[state]!,
    getOwnerWork: (owner: number): number => owner + 1, getGoalDistance: (): number => 0,
    distanceScale: 5, maxExpandedLabels: 100 }
  const complete = findFeasibleOwnerCorridor(options)
  expect(complete.result.found).toBe(true)
  expect(complete.work.queueComparisons).toBeGreaterThan(20)
  for (let cap = 0; cap < complete.work.workUnits; cap++) {
    const result = findFeasibleOwnerCorridor({ ...options, maxWorkUnits: cap })
    expect(result.result.found).toBe(false)
    if (result.result.found) throw new Error("Expected incomplete heap budget")
    expect(result.result.reason).toBe("expansion_limit")
    expect(result.work.workUnits).toBeLessThanOrEqual(cap)
  }
  expect(() => findFeasibleOwnerCorridor({ ...options, getOwnerWork: (): number => { throw new Error("meaningful native failure") } })).toThrow("meaningful native failure")
})
