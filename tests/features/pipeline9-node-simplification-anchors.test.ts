import { expect, test } from "bun:test"
import { createNodeSimplification, createShortcutRoute } from "tests/fixtures/node-simplification"

test("node simplification preserves ordinary via approaches and metadata anchors", () => {
  const route = {
    ...createShortcutRoute(),
    vias: [{ x: 0, y: 0 }],
    route: [
      ...Array.from({ length: 41 }, (_, i) => ({ x: -2 + i * 0.05, y: 0, z: 0 })),
      ...Array.from({ length: 41 }, (_, i) => ({ x: i * 0.05, y: 0, z: 1 })),
    ],
  }
  Object.assign(route.route[10]!, { traceThickness: 0.3 })
  const solver = createNodeSimplification({ routes: [route] })
  solver.solve()
  const output = solver.getOutput()[0]!
  expect(output.route).toEqual(route.route)
  for (const point of [...route.route.slice(8, 13), ...route.route.slice(38, 44)]) {
    expect(output.route).toContainEqual(point)
  }
  expect(output.vias).toEqual(route.vias)
  const transition = output.route.findIndex((p) => p.z === 1)
  expect(output.route[transition - 1]).toEqual({ x: 0, y: 0, z: 0 })
  expect(output.route[transition]).toEqual({ x: 0, y: 0, z: 1 })
})
