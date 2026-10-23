import { expect, test } from "bun:test"
import { DualPriceRouteColumnSolver, type RouteColumnGraph } from "lib/solvers/HyperHighDensitySolver/DualPriceRouteColumnSolver"

test("violated copper capacities generate genuinely new oracle paths and a compatible integral master", () => {
  const graph: RouteColumnGraph = {
    vertices: Array.from({ length: 6 }, (_, x) => ({ x, y: 0, z: 0 })),
    adjacency: Array.from({ length: 6 }, () => []),
  }
  const edges = [[0, 1, 0, 1], [0, 2, 1, 0.8], [2, 1, 2, 0.8], [3, 4, 3, 1], [3, 5, 4, 0.8], [5, 4, 5, 0.8]]
  for (const [a, b, primitive, cost] of edges) {
    graph.adjacency[a!]!.push({ to: b!, primitive: primitive!, cost: cost! })
    graph.adjacency[b!]!.push({ to: a!, primitive: primitive!, cost: cost! })
  }
  const solver = new DualPriceRouteColumnSolver({
    graph, tasks: [{ connectionName: "pair-a", owner: "root-a", start: 0, end: 1 }, { connectionName: "pair-b", owner: "root-b", start: 3, end: 4 }],
    primitivesConflict: (a, b): boolean => (a === 0 && b === 3) || (a === 3 && b === 0),
    permanentlyBlocked: (): boolean => false, maxIterations: 1000,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.columns.map((columns) => columns.map((column) => column.primitives))).toEqual([[[0], [1, 2]], [[3], [4, 5]]])
  expect(solver.paths.map((path) => path.primitives)).toEqual([[0], [4, 5]])
  expect(solver.capacityRows).toEqual([{ leftTask: 0, leftPrimitive: 0, rightTask: 1, rightPrimitive: 3, price: 1 }])
  expect(solver.counters.routeColumnPricingOracleCallCount).toBe(4)
  expect(solver.counters.routeColumnGeneratedColumnCount).toBe(4)
  expect(solver.counters.routeColumnNewPricedColumnCount).toBe(2)
  expect(solver.counters.routeColumnViolatedCapacityRowCount).toBe(1)
  expect(solver.counters.routeColumnCompatibleMasterSuccessCount).toBe(1)
  const exhaustive = [[0], [1, 2]].flatMap((a) => [[3], [4, 5]].filter((b) => !(a.includes(0) && b.includes(3))).map((b) => [a, b]))
  expect(exhaustive).toContainEqual(solver.paths.map((path) => path.primitives))
})
