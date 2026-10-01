import { expect, test } from "bun:test"
import { routeDynamicNetTree } from "lib/solvers/DynamicNetTreeSolver/routeDynamicNetTree"
import { segmentCopperGap } from "lib/solvers/DynamicNetTreeSolver/dynamicNetTreeGeometry"
import { sharedViaAllocationFixture } from "./shared-via-allocation-fixture"
import { options } from "./fixtures"

test("physical component forests conserve the shared via needed by four eastern terminals", () => {
  const problem = sharedViaAllocationFixture(),
    original = structuredClone(problem)
  const settings = { ...options, maxViasPerNet: 1, maxViasPerBranch: 1 }
  const control = routeDynamicNetTree(problem, settings)
  expect(control.solved).toBe(false)
  expect(control.stats.insertedVias).toBe(1)
  expect(control.traces).toEqual([])
  const planned = routeDynamicNetTree(problem, {
    ...settings,
    componentPlanning: "zero-via-forest",
  })
  expect(planned.solved).toBe(true)
  expect(planned.stats.finalComponents).toBe(1)
  expect(planned.stats.zeroViaForestJoins).toBeGreaterThan(0)
  const vias = planned.traces
    .flatMap((t) => t.route)
    .filter((p) => p.route_type === "via")
  expect(vias.length).toBe(1)
  expect(vias[0]!.x).toBeGreaterThan(6)
  expect(problem).toEqual(original)
  for (const trace of planned.traces)
    for (let i = 1; i < trace.route.length; i++) {
      const a = trace.route[i - 1]!,
        b = trace.route[i]!
      if (
        a.route_type !== "wire" ||
        b.route_type !== "wire" ||
        a.layer !== b.layer
      )
        continue
      for (const copper of problem.copper.filter(
        (c) =>
          c.owner !== problem.net &&
          c.layers.includes(a.layer === "top" ? 0 : 1),
      ))
        expect(segmentCopperGap(a, b, copper)).toBeGreaterThanOrEqual(
          problem.width / 2 + problem.clearance - 1e-8,
        )
    }
  for (const via of vias)
    for (const copper of problem.copper.filter((c) => c.owner !== problem.net))
      expect(segmentCopperGap(via, via, copper)).toBeGreaterThanOrEqual(
        problem.viaDiameter / 2 + problem.clearance - 1e-8,
      )
  expect(
    routeDynamicNetTree(problem, {
      ...settings,
      componentPlanning: "zero-via-forest",
    }).traces,
  ).toEqual(planned.traces)
})
