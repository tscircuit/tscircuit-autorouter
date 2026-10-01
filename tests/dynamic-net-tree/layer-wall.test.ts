import { expect, test } from "bun:test"
import { routeDynamicNetTree } from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"
import { options, teeProblem } from "./fixtures"
test("continuous foreign wall forces legal layer changes while preserving every terminal", () => {
  const p = teeProblem()
  p.terminals[2]!.point = { x: 10, y: 12 }
  p.copper.push({
    id: "wall",
    owner: "foreign",
    kind: "pad",
    layers: [0],
    start: { x: 5, y: 6.5 },
    end: { x: 5, y: 6.5 },
    radius: 0,
    rectangle: { width: 2, height: 19, rotation: 0 },
  })
  const result = routeDynamicNetTree(p, options)
  expect(result.solved).toBe(true)
  expect(result.stats.finalComponents).toBe(1)
  expect(
    result.traces.flatMap((r) => r.route).filter((p) => p.route_type === "via")
      .length,
  ).toBeGreaterThanOrEqual(2)
  for (const via of result.traces
    .flatMap((r) => r.route)
    .filter((p) => p.route_type === "via"))
    expect(via.x < 3.5 || via.x > 6.5).toBe(true)
})
