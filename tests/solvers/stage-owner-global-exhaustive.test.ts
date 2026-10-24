import { expect, test } from "bun:test"
import { findLazyMinimumOwnerRelease } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findLazyMinimumOwnerRelease"

type Edge = { state: number; owners: number[]; distance: number }

function objective(graph: Edge[][]): { owners: number; distance: number } {
  let owners = Infinity, distance = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const values = [0, Infinity, Infinity]
    for (let step = 0; step < 3; step++) for (let from = 0; from < 3; from++) for (const edge of graph[from]!) {
      if (edge.owners.every((owner): boolean => (mask & (1 << owner)) !== 0)) values[edge.state] = Math.min(values[edge.state]!, values[from]! + edge.distance)
    }
    if (!Number.isFinite(values[2])) continue
    const count = [0, 1, 2].filter((owner): boolean => (mask & (1 << owner)) !== 0).length
    if (count < owners || (count === owners && values[2]! < distance)) { owners = count; distance = values[2]! }
  }
  return { owners, distance }
}

test("split proof plus global distance matches exhaustive lexicographic subset oracle", (): void => {
  const slots = [[0, 1], [0, 2], [1, 0], [1, 2]], costs = [0.25, 0.5, 0, 1.25]
  const labels = [null, [], [0], [1], [2], [0, 1]]
  for (let encoding = 0; encoding < 1296; encoding++) {
    const graph: Edge[][] = [[], [], []]
    let digits = encoding
    for (const [index, [from, to]] of slots.entries()) {
      const owners = labels[digits % labels.length]
      digits = Math.floor(digits / labels.length)
      if (owners !== null) graph[from!]!.push({ state: to!, owners: owners!, distance: costs[index]! })
    }
    const expected = objective(graph)
    const result = findLazyMinimumOwnerRelease({ start: 0, getStateKey: (state: number): number => state,
      isGoal: (state: number): boolean => state === 2, getHops: (state: number): Edge[] => graph[state]!,
      distancePolicy: "global-minimum", maxWorkUnits: 100000 })
    expect(result.result.found).toBe(Number.isFinite(expected.distance))
    expect(result.work.workUnits).toBeLessThanOrEqual(100000)
    if (result.result.found) {
      expect(result.result.owners.size).toBe(expected.owners)
      expect(result.result.distance).toBe(expected.distance)
      expect(result.ownerMinimumProven).toBe(true)
      expect(result.globalDistanceMinimumProven).toBe(true)
      const forward = new Set(result.result.hops.flatMap((hop) => [...(hop.owners ?? [])]))
      expect([...result.result.owners]).toEqual([...forward])
    } else expect(result.result.reason).toBe("no_path")
  }
})
