import { expect, test } from "bun:test"
import { findLazyMinimumOwnerRelease } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findLazyMinimumOwnerRelease"

test("global refinement keeps same-node different owners and distance-sensitive subset labels", (): void => {
  const cases = [
    { graph: [[{ state: 1, owners: [1], distance: 0 }, { state: 1, owners: [2], distance: 1 }],
      [{ state: 2, owners: [2], distance: 0 }], []], owners: [2], distance: 1 },
    { graph: [[{ state: 1, owners: [1], distance: 100 }, { state: 1, owners: [1, 2], distance: 1 }],
      [{ state: 2, owners: [2], distance: 0 }], []], owners: [1, 2], distance: 1 },
    { graph: [[{ state: 2, owners: [1], distance: 1000000000 }, { state: 2, owners: [2], distance: 1 }], [], []], owners: [2], distance: 1 },
  ]
  for (const value of cases) {
    const options = { start: 0, getStateKey: (state: number): number => state,
      isGoal: (state: number): boolean => state === 2, getHops: (state: number) => value.graph[state]!,
      distancePolicy: "global-minimum" as const, maxWorkUnits: 10000 }
    const result = findLazyMinimumOwnerRelease(options)
    expect(result.result.found).toBe(true)
    if (!result.result.found) throw new Error("Controlled bounded-owner path must connect")
    expect(result.result.distance).toBe(value.distance)
    expect([...result.result.owners]).toEqual(value.owners)
    expect(result.globalDistanceMinimumProven).toBe(true)
    expect(result.work.shortestHopVisits).toBe(0)
    expect(result.work.globalAllocatedLabels).toBeGreaterThan(0)
    for (let cap = 0; cap < result.work.workUnits; cap++) {
      const limited = findLazyMinimumOwnerRelease({ ...options, maxWorkUnits: cap })
      expect(limited.result.found).toBe(false)
      if (limited.result.found) throw new Error("All required proof/refinement work must fit")
      expect(limited.result.reason).toBe("expansion_limit")
      expect(limited.work.workUnits).toBeLessThanOrEqual(cap)
      expect(limited.globalDistanceMinimumProven).toBe(false)
    }
  }
})
