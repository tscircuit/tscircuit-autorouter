import { expect, test } from "bun:test"
import { createNodeSimplification } from "tests/fixtures/node-simplification"

test("node-local simplification checks nearby pads and excludes distant obstacles", () => {
  const solver = createNodeSimplification({ obstacles: [
    { type: "rect", center: { x: 0, y: 0 }, width: 1, height: 1, layers: ["top"], connectedTo: [] },
    { type: "rect", center: { x: 100, y: 100 }, width: 1, height: 1, layers: ["top"], connectedTo: [] },
  ] })
  solver.solve()
  expect(solver.stats.obstacleCount).toBe(1)
  expect(solver.getOutput()[0]!.route.length).toBeGreaterThan(2)
})
