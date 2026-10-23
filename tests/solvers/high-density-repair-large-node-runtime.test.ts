import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { Pipeline4HighDensityRepairSolver } from "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { createHighDensityRepairRuntimeFixture } from "../fixtures/createHighDensityRepairRuntimeFixture"

test("large-node candidate ranges preserve ordered repairs and finite prefixes beside small nodes", async (): Promise<void> => {
  const input = createHighDensityRepairRuntimeFixture()
  for (const route of input.hdRoutes.slice(0, 2)) {
    const start = route.route[0]!
    const end = route.route.at(-1)!
    route.route = Array.from({ length: 257 }, (_, index) => ({
      x: start.x + (end.x - start.x) * index / 256,
      y: start.y,
      z: start.z,
    }))
  }
  const before = structuredClone(input)
  for (const limit of [0, 1, 2, 3, 5, Infinity]) {
    const expected = new Pipeline4HighDensityRepairSolver(structuredClone(input))
    const actual = new Pipeline4HighDensityRepairSolver(structuredClone(input))
    const runtime = new SolverRuntime()
    try {
      while (!expected.solved && !expected.failed && expected.iterations < limit) expected.step()
      await actual.solveAsync(runtime, limit)
      expect(actual.getOutput()).toEqual(expected.getOutput())
      expect(actual.stats).toEqual(expected.stats)
      expect(actual.iterations).toBe(expected.iterations)
      expect(actual.activeSampleIndex).toBe(expected.activeSampleIndex)
      expect(actual.solved).toBe(expected.solved)
      expected.solve()
      await actual.solveAsync(runtime)
      expect(actual.getOutput()).toEqual(expected.getOutput())
      expect(actual.stats).toEqual(expected.stats)
      expect(actual.iterations).toBe(expected.iterations)
      expect(actual.solved).toBeTrue()
    } finally {
      await runtime.dispose()
    }
  }
  expect(input).toEqual(before)
})
