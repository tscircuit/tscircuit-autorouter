import { expect, test } from "bun:test"
import { createNodeSimplification, createShortcutRoute } from "tests/fixtures/node-simplification"

test("node shortcut iteration budget handles more than 1000 protected vertices", () => {
  const route = {
    ...createShortcutRoute(),
    route: Array.from({ length: 1002 }, (_, i) => ({ x: -5, y: -4 + 8 * i / 1001, z: 0 })),
  }
  const solver = createNodeSimplification({ routes: [route] })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.getOutput()[0]!.route).toEqual(route.route)
})
