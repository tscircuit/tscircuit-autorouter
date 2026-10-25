import { expect, test } from "bun:test"
import { findOwnerCutPath, type OwnerCutHop } from "lib/solvers/HighDensitySolver/findOwnerCutPath"

test("owner cuts agree with exhaustive owner subsets including parallel conjunctive edges", (): void => {
  for (let graphIndex = 0; graphIndex < 256; graphIndex++) {
    const graph: OwnerCutHop[][] = Array.from({ length: 4 }, () => [])
    const edges = [[0, 1], [0, 2], [1, 2], [2, 1], [1, 3], [2, 3], [0, 3], [3, 0]]
    for (let edge = 0; edge < edges.length; edge++) {
      if (!(graphIndex & (1 << edge))) continue
      const [from, target] = edges[edge]!
      graph[from!]!.push({ target: target!, distance: 1,
        owners: edge % 3 === 0 ? [0, 1] : [edge % 2] })
    }
    // Parallel alternatives must remain separate OR choices in the learned cut.
    graph[0]!.push({ target: 1, owners: [2], distance: 2 })
    graph[0]!.push({ target: 1, owners: [0, 1], distance: 1 })
    const prices = [3, 5, 11]
    let exact = Infinity
    for (let mask = 0; mask < 8; mask++) {
      const seen = new Set([0]), queue = [0]
      for (let index = 0; index < queue.length; index++) {
        for (const hop of graph[queue[index]!]!) {
          if (hop.owners.some((owner) => !(mask & (1 << owner))) || seen.has(hop.target)) continue
          seen.add(hop.target)
          queue.push(hop.target)
        }
      }
      if (seen.has(3)) exact = Math.min(exact,
        prices.reduce((sum, price, owner) => sum + (mask & (1 << owner) ? price : 0), 0))
    }
    const result = findOwnerCutPath({ start: 0, goal: 3, stateCount: 4,
      getHops: (state): OwnerCutHop[] => graph[state]!,
      getOwnerPrice: (owner): number => prices[owner]!, maxWorkUnits: 1_000_000 })
    expect(result.status).toBe(Number.isFinite(exact) ? "found" : "no_path")
    if (result.status === "found") {
      expect(result.ownerFee).toBe(exact)
      expect(result.states[0]).toBe(0)
      expect(result.states.at(-1)).toBe(3)
      for (const hop of result.hops)
        expect(hop.owners.every((owner) => result.owners.includes(owner))).toBe(true)
    }
  }
})
