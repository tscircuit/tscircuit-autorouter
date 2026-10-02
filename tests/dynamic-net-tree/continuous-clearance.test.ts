import { expect, test } from "bun:test"
import {
  copperTouches,
  segmentCopperGap,
} from "lib/solvers/DynamicNetTreeSolver/dynamicNetTreeGeometry"
import { routeDynamicNetTree } from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"
import { options, teeProblem } from "./fixtures"
test("clearance uses the whole segment, actual circular lands, and required trace width", () => {
  const circular = {
    id: "circle",
    owner: "F",
    kind: "pad" as const,
    layers: [0],
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    radius: 0.75,
  }
  expect(
    segmentCopperGap({ x: 0.7, y: 0.7 }, { x: 2, y: 2 }, circular),
  ).toBeGreaterThan(0.2)
  expect(segmentCopperGap({ x: -2, y: 0 }, { x: 2, y: 0 }, circular)).toBe(
    -0.75,
  )
  expect(
    copperTouches(circular, {
      ...circular,
      id: "different-layer",
      layers: [1],
    }),
  ).toBe(false)
  const p = teeProblem()
  p.terminals = p.terminals.slice(0, 2)
  p.width = 0.8
  for (const y of [-3.35, 9.85])
    p.copper.push({
      id: `slit:${y}`,
      owner: "F",
      kind: "pad",
      layers: [0, 1],
      start: { x: 5, y },
      end: { x: 5, y },
      radius: 0,
      rectangle: { width: 2, height: 13, rotation: 0 },
    })
  const result = routeDynamicNetTree(p, options)
  expect(result.solved).toBe(false)
  expect(result.traces).toEqual([])
})
