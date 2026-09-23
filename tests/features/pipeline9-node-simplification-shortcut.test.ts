import { expect, test } from "bun:test"
import { createNodeSimplification } from "tests/fixtures/node-simplification"

test("node-local simplification removes a detour without mutating input or endpoint metadata", () => {
  const solver = createNodeSimplification()
  const original = structuredClone(solver.input.routes)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.getOutput()[0]).toEqual({ ...original[0], route: [original[0]!.route[0], original[0]!.route.at(-1)] })
  expect(solver.input.routes).toEqual(original)
  expect(solver.stats).toMatchObject({ inputPoints: 4, outputPoints: 2 })
})
