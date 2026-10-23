import { expect, test } from "bun:test"
import { DualPriceRouteColumnSolver, type RouteColumnGraph } from "lib/solvers/HyperHighDensitySolver/DualPriceRouteColumnSolver"

test("pricing policy exhaustion stays unknown and never merges same-net pair obligations", () => {
  const graph: RouteColumnGraph = {
    vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }],
    adjacency: [[{ to: 1, primitive: 0, cost: 1 }], [], [{ to: 3, primitive: 1, cost: 1 }], []],
  }
  const params = {
    graph, tasks: [{ connectionName: "pair-a", owner: "a", start: 0, end: 1 }, { connectionName: "pair-b", owner: "b", start: 2, end: 3 }],
    primitivesConflict: (): boolean => true, permanentlyBlocked: (): boolean => false, maxIterations: 1000, maxRounds: 2,
  }
  const unknown = new DualPriceRouteColumnSolver(params)
  unknown.solve()
  expect(unknown.failed).toBe(true)
  expect(unknown.error).toContain("feasibility remains unknown")
  expect(unknown.counters.routeColumnRoundBudgetExhaustionCount).toBe(1)
  expect(unknown.counters.routeColumnDuplicateColumnCount).toBeGreaterThan(0)
  const related = new DualPriceRouteColumnSolver({ ...params, tasks: params.tasks.map((task) => ({ ...task, owner: "shared-root" })) })
  related.solve()
  expect(related.solved).toBe(true)
  expect(related.paths).toHaveLength(2)
  expect(related.paths.map((path) => path.vertices)).toEqual([[0, 1], [2, 3]])
  expect(related.capacityRows).toHaveLength(0)
  const workLimit = new DualPriceRouteColumnSolver({ ...params, maxIterations: 1 })
  workLimit.solve()
  expect(workLimit.failed).toBe(true)
  expect(workLimit.counters.routeColumnBudgetExhaustionCount).toBe(1)
  expect(workLimit.counters.routeColumnCompatibleMasterSuccessCount).toBeUndefined()
})
