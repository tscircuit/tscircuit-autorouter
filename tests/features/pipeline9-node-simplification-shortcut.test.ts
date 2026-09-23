import { expect, test } from "bun:test"
import { createNodeSimplification, createShortcutRoute } from "tests/fixtures/node-simplification"

test("node-local simplification removes redundant vertices while preserving copper and endpoint segments", () => {
  const route = {
    ...createShortcutRoute(),
    route: Array.from({ length: 41 }, (_, i) => ({ x: -1 + i * 0.05, y: 0, z: 0 })),
  }
  const solver = createNodeSimplification({ routes: [route] })
  const original = structuredClone(route)
  solver.solve()
  const output = solver.getOutput()[0]!
  expect(output.route.length).toBeLessThan(original.route.length)
  expect(output.route.slice(0, 2)).toEqual(original.route.slice(0, 2))
  expect(output.route.slice(-2)).toEqual(original.route.slice(-2))
  expect(output.route.every((p) => p.y === 0 && p.z === 0)).toBeTrue()
  for (let i = 1; i < output.route.length; i++) {
    expect(output.route[i]!.x - output.route[i - 1]!.x).toBeLessThanOrEqual(0.25)
  }
  expect(output.regionId).toBe(original.regionId)
  expect(output.startPcbPortId).toBe(original.startPcbPortId)
  expect(route).toEqual(original)
})
