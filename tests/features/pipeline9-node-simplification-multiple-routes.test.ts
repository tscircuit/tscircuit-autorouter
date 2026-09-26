import { expect, test } from "bun:test"
import {
  createNodeSimplification,
  createShortcutRoute,
} from "tests/fixtures/node-simplification"

test("node simplification retains force control points in multi-route nodes", () => {
  const routes = [0, 0.3].map((y, index) => ({
    ...createShortcutRoute(),
    connectionName: `connection${index}`,
    route: Array.from({ length: 41 }, (_, i) => ({
      x: -1 + i * 0.05,
      y,
      z: 0,
    })),
  }))
  const solver = createNodeSimplification({ routes })
  solver.solve()
  expect(solver.getOutput()).toEqual(routes)
  expect(solver.stats.outputPoints).toBe(solver.stats.inputPoints)
})
