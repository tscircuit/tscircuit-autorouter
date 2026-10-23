import { expect, test } from "bun:test"
import { DualPriceRouteColumnSolver, type RouteColumn, type RouteColumnGraph } from "lib/solvers/HyperHighDensitySolver/DualPriceRouteColumnSolver"

test("the restricted compatibility master matches exhaustive generated-column assignments", () => {
  const graph: RouteColumnGraph = {
    vertices: Array.from({ length: 6 }, (_, x) => ({ x, y: 0, z: 0 })),
    adjacency: Array.from({ length: 6 }, () => []),
  }
  const edges = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [0, 3], [1, 4]]
  for (const [primitive, [a, b]] of edges.entries()) {
    graph.adjacency[a!]!.push({ to: b!, primitive, cost: 1 + primitive / 10 })
    graph.adjacency[b!]!.push({ to: a!, primitive, cost: 1 + primitive / 10 })
  }
  let successes = 0, unknown = 0, newColumns = 0
  for (let seed = 1; seed <= 64; seed++) {
    const conflicts = (a: number, b: number): boolean => {
      const left = Math.min(a, b), right = Math.max(a, b)
      return left === right || ((Math.imul(seed + left * 31 + right * 131, 1103515245) >>> 10) % 17) < 2
    }
    const solver = new DualPriceRouteColumnSolver({
      graph, tasks: [{ connectionName: "a", owner: "a", start: 0, end: 2 }, { connectionName: "b", owner: "b", start: 1, end: 4 }, { connectionName: "c", owner: "c", start: 3, end: 5 }],
      primitivesConflict: conflicts, permanentlyBlocked: (): boolean => false, maxIterations: 100_000, maxRounds: 8,
    })
    solver.solve()
    const compatible = (a: RouteColumn, b: RouteColumn): boolean => {
      for (const x of a.primitives) for (const y of b.primitives) {
        if (conflicts(x, y)) return false
      }
      return true
    }
    let hasAssignment = false
    for (const a of solver.columns[0]!) for (const b of solver.columns[1]!) for (const c of solver.columns[2]!) {
      if (compatible(a, b) && compatible(a, c) && compatible(b, c)) hasAssignment = true
    }
    expect(solver.counters.routeColumnBudgetExhaustionCount).toBeUndefined()
    expect(solver.solved, `seed ${seed}`).toBe(hasAssignment)
    if (solver.solved) successes++
    else { unknown++; expect(solver.error).toContain("feasibility remains unknown") }
    for (const [task, columns] of solver.columns.entries()) for (const column of columns) {
      expect(column.vertices[0]).toBe(solver.tasks[task]!.start)
      expect(column.vertices.at(-1)).toBe(solver.tasks[task]!.end)
      const cost = column.primitives.reduce((sum, primitive) => sum + 1 + primitive / 10, 0)
      expect(column.cost).toBeCloseTo(cost, 9)
    }
    newColumns += solver.counters.routeColumnNewPricedColumnCount ?? 0
  }
  expect(successes).toBeGreaterThan(0)
  expect(unknown).toBeGreaterThan(0)
  expect(newColumns).toBeGreaterThan(0)
})
