import { expect, test } from "bun:test"
import { Pipeline9DenseBoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9DenseBoundedRegionalRepairSolver"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("dense bounded regional repairs preserve guarded publication and every regional work counter", (): void => {
  const fixture = createBoundedRegionalRepairFixture(3)
  const original = structuredClone(fixture.routes)
  const baseline = new Pipeline9BoundedRegionalRepairSolver(fixture)
  const dense = new Pipeline9DenseBoundedRegionalRepairSolver(fixture)
  while (!baseline.solved && !baseline.failed) {
    baseline.step()
    dense.step()
    expect(dense.stats).toEqual(baseline.stats)
    expect(dense.solved).toBe(baseline.solved)
  }
  expect(dense.failed).toBeFalse()
  expect(dense.getResult()).toEqual(baseline.getResult())
  expect(dense.iterations).toBe(baseline.iterations)
  expect(dense.MAX_ITERATIONS).toBe(baseline.MAX_ITERATIONS)
  expect(dense.getResult().repaired).toBeTrue()
  expect(dense.getResult().pathSearchNodeCount).toBeGreaterThan(0)
  expect(fixture.routes).toEqual(original)
})
