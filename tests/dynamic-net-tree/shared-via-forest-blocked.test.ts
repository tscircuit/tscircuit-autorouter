import { expect, test } from "bun:test"
import { routeDynamicNetTree } from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"
import { sharedViaAllocationFixture } from "./shared-via-allocation-fixture"
import { options } from "./fixtures"

test("component forests preserve foreign layers and fail without a candidate when their budget is depleted", () => {
  const problem = sharedViaAllocationFixture(),
    original = structuredClone(problem)
  const settings = {
    ...options,
    maxViasPerNet: 1,
    componentPlanning: "zero-via-forest" as const,
  }
  const zero = routeDynamicNetTree(problem, { ...settings, maxViasPerNet: 0 })
  expect(zero.solved).toBe(false)
  expect(zero.traces).toEqual([])
  expect(problem).toEqual(original)
  const exhausted = routeDynamicNetTree(problem, {
    ...settings,
    maxExpansions: 5,
  })
  expect(exhausted.solved).toBe(false)
  expect(exhausted.error).toContain("budget exhausted")
  expect(exhausted.traces).toEqual([])
  problem.copper.find((c) => c.id === "bottom-bus")!.end = { x: 4, y: 6 }
  problem.copper.find((c) => c.id === "top-separator")!.layers = [0, 1]
  const closed = routeDynamicNetTree(problem, settings)
  expect(closed.solved).toBe(false)
  expect(closed.traces).toEqual([])
})
