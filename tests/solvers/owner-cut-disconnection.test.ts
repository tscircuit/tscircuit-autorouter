import { expect, test } from "bun:test"
import { findOwnerCutPath, type OwnerCutHop } from "lib/solvers/HighDensitySolver/findOwnerCutPath"

test("only a completely exhausted reachable component proves frozen-graph disconnection", (): void => {
  const graph: OwnerCutHop[][] = [[{ target: 1, owners: [0], distance: 1 }],
    [{ target: 0, owners: [], distance: 1 }], []]
  const result = findOwnerCutPath({ start: 0, goal: 2, stateCount: 3,
    getHops: (state): OwnerCutHop[] => graph[state]!,
    getOwnerPrice: (_owner): number => 1, maxWorkUnits: 10_000 })
  expect(result.status).toBe("no_path")
  expect(result.work.learnedCuts).toBe(1)
  expect(result.work.expandedStates).toBe(3)
})
