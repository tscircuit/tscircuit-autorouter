import { expect, test } from "bun:test"
import { createNodeSimplification, createShortcutRoute } from "tests/fixtures/node-simplification"

test("node-local simplification preserves via positions and layer transitions", () => {
  const route = createShortcutRoute()
  route.vias = [{ x: 2, y: 2 }]
  route.route.splice(3, 0, { x: 2, y: 2, z: 1 })
  route.route.at(-1)!.z = 1
  const solver = createNodeSimplification({ routes: [route] })
  solver.solve()
  const result = solver.getOutput()[0]!
  expect(result.vias).toEqual(route.vias)
  expect(result.route).toContainEqual({ x: 2, y: 2, z: 0 })
  expect(result.route).toContainEqual({ x: 2, y: 2, z: 1 })
  expect(result.regionId).toBe("node")
})
