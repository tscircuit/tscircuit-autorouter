import { expect, test } from "bun:test"
import { routeDynamicNetTree } from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"
import { segmentCopperGap } from "lib/solvers/DynamicNetTreeSolver/dynamicNetTreeGeometry"
import { options, teeProblem } from "./fixtures"

test("search spatial bins retain a hole beyond the default clearance neighborhood", () => {
  const problem = teeProblem()
  problem.bounds = { minX: 0, maxX: 4, minY: -3, maxY: 3 }
  problem.outline = [
    { x: 0, y: -3 },
    { x: 4, y: -3 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ]
  problem.terminals = [
    { id: "a", point: { x: 2, y: -2 }, layers: [0] },
    { id: "b", point: { x: 2, y: 2 }, layers: [0] },
  ]
  problem.width = 0.1
  problem.clearance = 0.1
  problem.traceToHoleClearance = 0.5
  problem.viaDiameter = 0.3
  problem.viaHoleDiameter = 0.15
  problem.holeClearance = 0.1
  const hole = {
    id: "mechanical-hole",
    owner: "unassigned",
    kind: "hole" as const,
    layers: [0, 1],
    start: { x: 1, y: 0 },
    end: { x: 1, y: 0 },
    radius: 0.5,
    holeDiameter: 1,
  }
  problem.copper = [hole]
  const result = routeDynamicNetTree(problem, {
    ...options,
    gridStep: 0.25,
    maxViasPerNet: 0,
    maxViasPerBranch: 0,
  })
  expect(result.solved).toBe(true)
  for (const trace of result.traces)
    for (let i = 0; i < trace.route.length - 1; i++) {
      const a = trace.route[i]!,
        b = trace.route[i + 1]!
      if (a.route_type !== "wire" || b.route_type !== "wire") continue
      expect(segmentCopperGap(a, b, hole)).toBeGreaterThanOrEqual(0.55 - 1e-8)
    }
})
