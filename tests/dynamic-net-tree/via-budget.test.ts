import { expect, test } from "bun:test"
import { routeDynamicNetTree } from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"
import { options, teeProblem } from "./fixtures"
test("hard via budget rejects an excursion at zero or one and admits its exact two-via requirement", () => {
  const p = teeProblem()
  p.terminals = p.terminals.slice(0, 2)
  p.copper.push({
    id: "top-wall",
    owner: "F",
    kind: "pad",
    layers: [0],
    start: { x: 5, y: 6.5 },
    end: { x: 5, y: 6.5 },
    radius: 0,
    rectangle: { width: 2, height: 19, rotation: 0 },
  })
  for (const budget of [0, 1]) {
    const r = routeDynamicNetTree(p, {
      ...options,
      maxViasPerBranch: budget,
      maxViasPerNet: budget,
    })
    expect(r.solved).toBe(false)
    expect(r.traces).toEqual([])
  }
  const r = routeDynamicNetTree(p, {
    ...options,
    maxViasPerBranch: 2,
    maxViasPerNet: 2,
  })
  expect(r.solved).toBe(true)
  expect(
    r.traces.flatMap((t) => t.route).filter((p) => p.route_type === "via")
      .length,
  ).toBe(2)
  expect(() =>
    routeDynamicNetTree(p, { ...options, maxViasPerNet: NaN }),
  ).toThrow("via budget")
})
