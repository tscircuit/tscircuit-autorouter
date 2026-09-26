import { expect, test } from "bun:test"
import { createNodeSimplification, createShortcutRoute } from "tests/fixtures/node-simplification"

test("node-local shortcuts leave boundary copper unchanged", () => {
  const route = createShortcutRoute()
  route.route[0]!.x = -5
  route.route.at(-1)!.x = 5
  const solver = createNodeSimplification({ routes: [route] })
  solver.solve()
  expect(solver.getOutput()).toEqual([route])
})
