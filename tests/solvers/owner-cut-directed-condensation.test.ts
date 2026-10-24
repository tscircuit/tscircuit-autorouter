import { expect, test } from "bun:test"
import { buildOwnerCutCondensation } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/buildOwnerCutCondensation"

test("zero-owner SCC quotient preserves directed reachability for every released subset", (): void => {
  let seed = 919
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    // Same deterministic graph and all sixteen released sets are independent.
    // Goal nodes are absorbing as in the native blocker-query oracle.
    // The comparison never assumes that free arcs are undirected.
    return seed / 2 ** 32
  }
  for (let trial = 0; trial < 400; trial++) {
    const graph = Array.from({ length: 8 }, () => [] as Array<{ state: number; owners: number[]; distance: number }>)
    for (let from = 0; from < 8; from++) for (let to = 0; to < 8; to++) if (random() < 0.27) graph[from]!.push({ state: to, distance: 1, owners: Array.from({ length: 4 }, (_, owner): number => owner).filter((): boolean => random() < 0.18) })
    const condensed = buildOwnerCutCondensation({ start: 0, getStateKey: (state: number): number => state, isGoal: (state: number): boolean => state === 7, getHops: (state: number) => graph[state]!, getOwners: (hop) => hop.owners!, charge: (): boolean => true })
    if (!condensed) throw new Error("Unlimited condensation must complete")
    for (let mask = 0; mask < 16; mask++) {
      const reached = new Set([0])
      const queue = [0]
      for (let index = 0; index < queue.length; index++) for (const hop of queue[index] === 7 ? [] : graph[queue[index]!]!) {
        if (!hop.owners.every((owner): boolean => (mask & (1 << owner)) !== 0) || reached.has(hop.state)) continue
        reached.add(hop.state)
        queue.push(hop.state)
      }
      const components = new Set([condensed.start])
      const pending = [condensed.start]
      for (let index = 0; index < pending.length; index++) for (const arc of condensed.adjacency[pending[index]!]!) {
        if (!arc.owners.every((owner): boolean => (mask & (1 << owner)) !== 0) || components.has(arc.to)) continue
        components.add(arc.to)
        pending.push(arc.to)
      }
      expect([...condensed.goals].some((goal): boolean => components.has(goal))).toBe(reached.has(7))
    }
  }
})
