import { expect, test } from "bun:test"
import { findDistinctOwnerBlockerPath, type DistinctOwnerBlockerHop } from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"
import { findCutGuidedOwnerRelease } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findCutGuidedOwnerRelease"

type Hop = DistinctOwnerBlockerHop<number, number>

test("directed owner cuts match exhaustive owner subsets and native lexicographic search", (): void => {
  let seed = 8172
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    // Fixed reproducible graphs include repeated owners, zero edges and cycles.
    // The oracle below enumerates every owner subset independently.
    // Its only optimization is an ordinary scalar distance relaxation.
    return seed / 2 ** 32
  }
  for (let trial = 0; trial < 1200; trial++) {
    const graph: Hop[][] = Array.from({ length: 6 }, (): Hop[] => [])
    for (let from = 0; from < 6; from++) for (let to = 0; to < 6; to++) {
      if (random() > 0.27) continue
      const owners = Array.from({ length: 5 }, (_, id): number => id).filter((): boolean => random() < 0.28)
      graph[from]!.push({ state: to, distance: Math.floor(random() * 7), owners })
    }
    let expectedOwners = Infinity
    let expectedDistance = Infinity
    for (let mask = 0; mask < 32; mask++) {
      const distances = [0, Infinity, Infinity, Infinity, Infinity, Infinity]
      for (let pass = 0; pass < 6; pass++) for (let from = 0; from < 6; from++) for (const hop of graph[from]!) {
        if (!(hop.owners ?? []).every((owner): boolean => (mask & (1 << owner)) !== 0)) continue
        distances[hop.state] = Math.min(distances[hop.state]!, distances[from]! + hop.distance)
      }
      if (!Number.isFinite(distances[5])) continue
      const count = mask.toString(2).replaceAll("0", "").length
      if (count < expectedOwners || (count === expectedOwners && distances[5]! < expectedDistance)) {
        expectedOwners = count
        expectedDistance = distances[5]!
      }
    }
    const options = { start: 0, getStateKey: (state: number): number => state, isGoal: (state: number): boolean => state === 5, getHops: (state: number): Hop[] => graph[state]! }
    const actual = findCutGuidedOwnerRelease({ ...options, maxWorkUnits: 2_000_000 })
    const native = findDistinctOwnerBlockerPath(options)
    expect(actual.result.found).toBe(Number.isFinite(expectedOwners))
    expect(actual.result.found).toBe(native.found)
    if (actual.result.found && native.found) {
      expect(actual.result.owners.size).toBe(expectedOwners)
      expect(actual.result.distance).toBe(expectedDistance)
      expect(actual.result.owners.size).toBe(native.owners.size)
      expect(actual.result.distance).toBe(native.distance)
      expect(actual.ownerMinimumProven && actual.distanceMinimumProven).toBe(true)
    } else if (!actual.result.found) expect(actual.result.reason).toBe("no_path")
  }
})
