import { expect, test } from "bun:test"
import { routeDynamicNetTree } from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"
import { options, teeProblem } from "./fixtures"

test("whole-net via budget persists across branches while an existing bottom branch is reused", () => {
  const p = teeProblem()
  p.terminals = [0, 6, 12].map((x, i) => ({
    id: `P${i}`,
    point: { x, y: 0 },
    layers: [0],
  }))
  for (const x of [3, 9])
    p.copper.push({
      id: `top-wall:${x}`,
      owner: "F",
      kind: "pad",
      layers: [0],
      start: { x, y: 6.5 },
      end: { x, y: 6.5 },
      radius: 0,
      rectangle: { width: 1, height: 19, rotation: 0 },
    })
  const rejected = routeDynamicNetTree(p, {
    ...options,
    maxViasPerBranch: 2,
    maxViasPerNet: 2,
  })
  expect(rejected.solved).toBe(false)
  expect(rejected.stats.branches).toBe(1)
  expect(rejected.traces).toEqual([])
  const accepted = routeDynamicNetTree(p, {
    ...options,
    maxViasPerBranch: 2,
    maxViasPerNet: 3,
  })
  expect(accepted.solved).toBe(true)
  expect(accepted.stats.branches).toBe(2)
  expect(
    accepted.traces
      .flatMap((t) => t.route)
      .filter((v) => v.route_type === "via").length,
  ).toBe(3)
})
