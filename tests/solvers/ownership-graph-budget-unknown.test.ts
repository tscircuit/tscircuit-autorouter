import { expect, test } from "bun:test"
import { SharedOwnershipGraphSolver, type OwnershipGraph } from "lib/solvers/HyperHighDensitySolver/SharedOwnershipGraphSolver"

test("a connectivity work limit is unknown and creates no cut or infeasibility claim", () => {
  const graph: OwnershipGraph = {
    vertices: Array.from({ length: 10 }, (_, x) => ({ x, y: 0, z: 0 })),
    adjacency: Array.from({ length: 10 }, (_, vertex) => vertex < 9 ? [{ to: vertex + 1, primitive: vertex, cost: 1 }] : []),
  }
  const solver = new SharedOwnershipGraphSolver({
    graph, tasks: [{ connectionName: "a", owner: "root-a", start: 0, end: 9 }],
    primitivesConflict: (): boolean => false,
    permanentlyBlocked: (): boolean => false,
    maxIterations: 2,
  })
  solver.solve()
  expect(solver.failed).toBe(true)
  expect(solver.exhaustedFiniteModel).toBe(false)
  expect(solver.learnedClauses).toHaveLength(0)
  expect(solver.counters.ownershipGraphBudgetExhaustionCount).toBe(1)
  expect(solver.counters.ownershipGraphExhaustedConnectivityCount).toBeUndefined()
})
