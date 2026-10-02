import { expect, test } from "bun:test"
import { routeDynamicNetTree } from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"
import { options, teeProblem } from "./fixtures"

test("a raw independent drill blocks a buried via beyond its land's copper layer", () => {
  const problem = teeProblem()
  problem.layerCount = 4
  problem.allowBlindAndBuriedVias = true
  problem.width = 0.1
  problem.viaDiameter = 0.3
  problem.viaHoleDiameter = 0.15
  problem.bounds = { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 }
  problem.outline = [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }]
  problem.terminals = [
    { id: "inner-a", point: { x: 0, y: 0 }, layers: [1] },
    { id: "inner-b", point: { x: 0, y: 0 }, layers: [2] },
  ]
  problem.copper = [{
    id: "land", owner: "foreign", kind: "pad", layers: [0],
    start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, radius: 0.6,
    drill: { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, diameter: 1, layers: [0, 1, 2, 3] },
  }]
  const original = structuredClone(problem)
  const result = routeDynamicNetTree(problem, { ...options, gridStep: 0.25, maxViasPerNet: 1 })
  expect(result.solved).toBe(false)
  expect(result.traces).toEqual([])
  expect(problem).toEqual(original)
})
