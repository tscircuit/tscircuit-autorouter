import { expect, test } from "bun:test"
import { findLazyMinimumOwnerRelease } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findLazyMinimumOwnerRelease"

type Edge = { to: number; owners: number[]; distance: number }

function distanceWithOwners(graph: Edge[][], mask: number): number {
  const distances = [0, Infinity, Infinity]
  // Independent Bellman-Ford on the original directed edges, without cuts,
  // a master solver, baseline regions, or the implementation's priority queue.
  for (let step = 0; step < graph.length; step++) {
    for (let from = 0; from < graph.length; from++) for (const edge of graph[from]!) {
      if (edge.owners.every((owner): boolean => (mask & (1 << owner)) !== 0)) {
        distances[edge.to] = Math.min(distances[edge.to]!, distances[from]! + edge.distance)
      }
    }
  }
  return distances[2]!
}

test("lazy directed owner cuts match every owner subset on1296 conjunctive graphs", (): void => {
  const slots = [[0, 1], [0, 2], [1, 0], [1, 2]]
  const labels = [null, [], [0], [1], [2], [0, 1]]
  for (let encoding = 0; encoding < 6 ** slots.length; encoding++) {
    const graph: Edge[][] = [[], [], []]
    let digits = encoding
    for (const [index, [from, to]] of slots.entries()) {
      const owners = labels[digits % labels.length]
      digits = Math.floor(digits / labels.length)
      if (owners !== null) graph[from!]!.push({ to: to!, owners: owners!, distance: index % 3 })
    }
    let minimum = Infinity
    for (let mask = 0; mask < 8; mask++) {
      if (Number.isFinite(distanceWithOwners(graph, mask))) {
        const count = [0, 1, 2].filter((owner): boolean => (mask & (1 << owner)) !== 0).length
        minimum = Math.min(minimum, count)
      }
    }
    const result = findLazyMinimumOwnerRelease({ start: 0, getStateKey: (state: number): number => state,
      isGoal: (state: number): boolean => state === 2,
      getHops: (state: number) => graph[state]!.map((edge) => ({ state: edge.to, owners: edge.owners, distance: edge.distance })),
      maxWorkUnits: 100000 })
    expect(result.result.found).toBe(Number.isFinite(minimum))
    expect(result.globalDistanceMinimumProven).toBe(false)
    expect(result.work.workUnits).toBeLessThanOrEqual(100000)
    if (result.result.found) {
      expect(result.result.owners.size).toBe(minimum)
      expect(result.ownerMinimumProven).toBe(true)
      expect(result.chosenSetDistanceMinimumProven).toBe(true)
      const mask = [...result.result.owners].reduce((value, owner): number => value | (1 << owner), 0)
      expect(result.result.distance).toBe(distanceWithOwners(graph, mask))
      const union = new Set(result.result.hops.flatMap((hop) => [...(hop.owners ?? [])]))
      expect([...union].sort()).toEqual([...result.result.owners].sort())
    } else expect(result.result.reason).toBe("no_path")
  }
})
