import { expect, test } from "bun:test"
import { SharedOwnershipGraphSolver, type OwnershipGraph } from "lib/solvers/HyperHighDensitySolver/SharedOwnershipGraphSolver"

test("a learned cut survives backtracking while retaining unrelated prefixes and exact pair identities", () => {
  const graph: OwnershipGraph = {
    vertices: Array.from({ length: 8 }, (_, x) => ({ x, y: 0, z: 0 })),
    adjacency: Array.from({ length: 8 }, () => []),
  }
  const edges = [[0, 1, 0, 1], [2, 3, 1, 1], [2, 4, 2, 2], [4, 3, 3, 2], [5, 6, 4, 1]]
  for (const [a, b, primitive, cost] of edges) {
    graph.adjacency[a!]!.push({ to: b!, primitive: primitive!, cost: cost! })
    graph.adjacency[b!]!.push({ to: a!, primitive: primitive!, cost: cost! })
  }
  const solver = new SharedOwnershipGraphSolver({
    graph,
    tasks: [
      { connectionName: "prefix", owner: "root-prefix", start: 0, end: 1 },
      { connectionName: "pair-a", owner: "shared-root", start: 2, end: 3 },
      { connectionName: "pair-b", owner: "other-root", start: 5, end: 6 },
    ],
    primitivesConflict: (a, b): boolean => (a === 1 && b === 4) || (b === 1 && a === 4),
    permanentlyBlocked: (): boolean => false,
    maxIterations: 1000,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.paths.map((path) => path.primitives)).toEqual([[0], [2, 3], [4]])
  expect(solver.learnedClauses).toEqual([{ owners: [{ task: 1, primitive: 1 }], exclusions: [] }])
  expect(solver.counters.ownershipGraphRetainedPrefixPathCount).toBe(1)
  expect(solver.counters.ownershipGraphBranchAttemptCount).toBe(2)
  // An electrical root is independent from pair identity. Same-net paths may
  // share geometry, while the task endpoint obligations are still separate.
  const sameRoot = new SharedOwnershipGraphSolver({
    graph, tasks: [
      { connectionName: "same-a", owner: "root", start: 2, end: 3 },
      { connectionName: "same-b", owner: "root", start: 5, end: 6 },
    ], primitivesConflict: (): boolean => true, permanentlyBlocked: (): boolean => false, maxIterations: 1000,
  })
  sameRoot.solve()
  expect(sameRoot.solved).toBe(true)
  expect(sameRoot.paths).toHaveLength(2)
  expect(sameRoot.learnedClauses).toHaveLength(0)
})
