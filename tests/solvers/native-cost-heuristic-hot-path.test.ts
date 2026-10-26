import { expect, test } from "bun:test"
import {
  createModelNode,
  createNativeHeuristicSolver,
  type MovementModel,
} from "./nativeCostHeuristicTestUtils"

test("Native cost setters share the movement estimate and retain future costs only in g", (): void => {
  const model: MovementModel = {
    coordinates: [0, 0.4, 1],
    layers: [0, 1, 2],
    goal: { x: 1, y: 1, z: 0 },
    goalRadius: 0.05 * Math.SQRT2,
    misalignment: 5,
    flip: false,
    viaCost: 0.4,
  }
  const solver = createNativeHeuristicSolver(model)
  const node = {
    ...createModelNode({ x: 0.4, y: 0.4, z: 0 }),
    parent: { ...createModelNode({ x: 0.35, y: 0.4, z: 0 }), g: 0.7 },
  }
  expect(solver.getFutureConnectionPenalty(node, false)).toBeGreaterThan(0)
  const expectedG = solver.computeG(node)
  const expectedH = solver.computeH(node)
  solver.setNodeCosts(node)
  expect(node.g).toBe(expectedG)
  expect(node.h).toBe(expectedH)
  expect(node.f).toBe(solver.computeF(expectedG, expectedH))
  expect(solver.GREEDY_MULTIPLER).toBe(2.2)

  const sameOrientation = createNativeHeuristicSolver({
    ...model,
    layers: [0, 2],
  })
  const oppositeOrientation = createNativeHeuristicSolver(model)
  const wrongAxis = createModelNode({ x: 1, y: 0, z: 0 })
  expect(sameOrientation.computeH(wrongAxis)).toBeGreaterThan(
    oppositeOrientation.computeH(wrongAxis),
  )
  const flipped = createNativeHeuristicSolver({ ...model, flip: true })
  expect(flipped.computeH(wrongAxis)).toBeLessThan(solver.computeH(wrongAxis))

  const goal = createModelNode(model.goal)
  expect(solver.computeH(goal)).toBe(0)
  expect(() =>
    createNativeHeuristicSolver({ ...model, misalignment: -1 }),
  ).toThrow("Native movement penalties must be finite and nonnegative")
  expect(() =>
    createNativeHeuristicSolver({ ...model, misalignment: Infinity }),
  ).toThrow("Native movement penalties must be finite and nonnegative")
})
