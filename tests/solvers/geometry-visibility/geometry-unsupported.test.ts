import { expect, test } from "bun:test"
import { GeometryAutoroutingPipelineSolver } from "lib/testing/GeometryAutoroutingPipelineSolver"
import { krtTestBoard } from "../krt/krtTestBoard"

test("geometry challenger explicitly rejects unimplemented paired constraints", () => {
  const input = krtTestBoard()
  input.differentialPairs = [{ connectionNames: ["tree", "other"], lengthTolerance: 0.1 }]
  const solver = new GeometryAutoroutingPipelineSolver(input)
  expect(() => solver.solve()).toThrow("does not support")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(() => solver.getOutputSimpleRouteJson()).toThrow()
})
