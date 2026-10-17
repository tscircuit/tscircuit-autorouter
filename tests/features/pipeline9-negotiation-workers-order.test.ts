import { expect, test } from "bun:test"
import { extractRepairRegion } from "@tscircuit/repair04"
import { NodePipeline9RepairRuntime } from "lib/autorouter-pipelines/Pipeline9_Parallel/NodePipeline9RepairRuntime"
import { runPipeline9NegotiationTask, type Pipeline9NegotiationTask } from "lib/autorouter-pipelines/Pipeline9_Parallel/pipeline9NegotiationTask"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("eight workers preserve task order and deterministic results when the pool is reused", async (): Promise<void> => {
  const fixture = createBoundedRegionalRepairFixture()
  const region = extractRepairRegion({ srj: { ...fixture.originalSrj, traces: undefined }, routes: fixture.routes, bounds: fixture.originalSrj.bounds })
  const tasks: Pipeline9NegotiationTask[] = Array.from({ length: 10 }, (_, index) => ({
    srj: region.srj, routes: region.routes, bounds: region.mutableBounds,
    lockedPointIndices: region.lockedPointIndices, dirtyRouteIndices: [0],
    allowLayerChanges: true, traceClearance: 0.1, viaClearance: 0.1,
    viaHoleDiameter: 0.15, maxPathSearchNodes: 10_000 + index * 1000,
    maxPathSearchCalls: 2 + index, pathHeuristicWeight: 1 + index,
  }))
  const expected = tasks.map(runPipeline9NegotiationTask)
  const runtime = new NodePipeline9RepairRuntime(8)
  try {
    expect(runtime.runNegotiations([])).toEqual([])
    expect(runtime.runNegotiations(tasks)).toEqual(expected)
    expect(runtime.runNegotiations(tasks.slice().reverse())).toEqual(expected.slice().reverse())
  } finally {
    await runtime.dispose()
  }
  expect(() => runtime.runNegotiations(tasks)).toThrow("disposed")
})
