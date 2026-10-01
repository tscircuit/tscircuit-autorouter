import { expect, test } from "bun:test"
import { routeDynamicNetTree } from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"
import { options, teeProblem } from "./fixtures"
test("preloaded connected trunk and remote same-net island are retained and physically joined", () => {
  const p = teeProblem()
  p.copper = [
    {
      id: "fixed-trunk",
      owner: "N",
      kind: "wire",
      layers: [0],
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      radius: 0.1,
    },
    {
      id: "fixed-island",
      owner: "N",
      kind: "wire",
      layers: [0],
      start: { x: 13, y: 0 },
      end: { x: 14, y: 0 },
      radius: 0.1,
    },
  ]
  const original = JSON.stringify(p)
  const result = routeDynamicNetTree(p, options)
  expect(result.solved).toBe(true)
  expect(result.stats.initialComponents).toBe(3)
  expect(result.stats.finalComponents).toBe(1)
  expect(JSON.stringify(p)).toBe(original)
  expect(
    result.attachments.some(
      (a) => a.sourceCopperId === "fixed-trunk" && a.source.x === 5,
    ),
  ).toBe(true)
  expect(
    result.attachments.some((a) => a.targetCopperId === "fixed-island"),
  ).toBe(true)
})
