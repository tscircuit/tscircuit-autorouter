import { expect, test } from "bun:test"
import type { DistinctOwnerBlockerHop } from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"
import { findFeasibleOwnerCorridor } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findFeasibleOwnerCorridor"

test("directed feasible witnesses and selected-set distances match an independent exhaustive graph oracle", (): void => {
  type Hop = DistinctOwnerBlockerHop<number, number, number>
  const arcs = [[0, 1], [1, 0], [1, 2], [2, 1], [0, 2], [2, 0], [2, 3], [3, 1]] as const
  for (let graphMask = 0; graphMask < 256; graphMask++) {
    for (let resourcePattern = 0; resourcePattern < 4; resourcePattern++) {
      const graph: Hop[][] = [[], [], [], []]
      for (let edge = 0; edge < arcs.length; edge++) {
        if (!(graphMask & (1 << edge))) continue
        const [from, to] = arcs[edge]!
        const resource = (edge + resourcePattern) % 4
        graph[from]!.push({ state: to, owners: resource === 0 ? [] : resource === 3 ? [0, 1, 0] : [resource - 1],
          distance: edge % 3 === 0 ? 0 : (edge + 1) / 4, data: edge })
      }
      const distances = (allowed: ReadonlySet<number>): number[] => {
        const values = [0, Infinity, Infinity, Infinity]
        for (let round = 0; round < 4; round++) for (let from = 0; from < 4; from++) {
          for (const hop of graph[from]!) {
            if ([...(hop.owners ?? [])].some((owner): boolean => !allowed.has(owner))) continue
            values[hop.state] = Math.min(values[hop.state]!, values[from]! + hop.distance)
          }
        }
        return values
      }
      const all = distances(new Set([0, 1])), answer = findFeasibleOwnerCorridor({ start: 0,
        getStateKey: (state: number): number => state, isGoal: (state: number): boolean => state === 3,
        getHops: (state: number): Hop[] => graph[state]!, getOwnerWork: (owner: number): number => owner === 0 ? 7 : 2,
        getGoalDistance: (): number => 0, distanceScale: 3, maxExpandedLabels: 100 })
      expect(answer.result.found).toBe(Number.isFinite(all[3]))
      if (!answer.result.found) { expect(answer.result.reason).toBe("no_path"); continue }
      const result = answer.result, union = new Set<number>()
      expect(result.states[0]).toBe(0)
      expect(result.states.at(-1)).toBe(3)
      let distance = 0
      for (let i = 0; i < result.hops.length; i++) {
        const hop = result.hops[i]!
        expect(graph[result.states[i]!]!.includes(hop)).toBe(true)
        expect(hop.state).toBe(result.states[i + 1]!)
        for (const owner of hop.owners ?? []) union.add(owner)
        distance += hop.distance
      }
      expect([...result.owners]).toEqual([...union])
      expect(result.distance).toBe(distance)
      expect(result.distance).toBe(distances(union)[3]!)
      expect(answer.objectiveMinimumProven).toBe(false)
      expect(answer.chosenSetDistanceMinimumProven).toBe(true)
    }
  }
})
