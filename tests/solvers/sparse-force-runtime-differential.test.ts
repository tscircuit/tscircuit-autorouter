import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { createHighDensityForceImproveRuntimeFixture } from "tests/fixtures/createHighDensityForceImproveRuntimeFixture"
import { createControlledForceImproveRuntime } from "tests/fixtures/createControlledForceImproveRuntime"
import { createPipeline9TestRuntime } from "tests/fixtures/createPipeline9TestRuntime"
import { expectHighDensityForceImproveState } from "tests/fixtures/expectHighDensityForceImproveState"

test("sparse force sync, worker, ordered async and budget resume retain actual native results", async () => {
  const params = { ...createHighDensityForceImproveRuntimeFixture(), totalStepsPerNode: 12 }
  const before = structuredClone(params)
  const native = new HighDensityForceImproveSolver(params)
  native.solve()
  const off = new Pipeline9HighDensityForceImproveSolver(params)
  off.solve()
  expectHighDensityForceImproveState(off, native)
  expect(Object.hasOwn(off, "sparseForceStats")).toBe(false)
  const sync = new Pipeline9HighDensityForceImproveSolver({ ...params, experimentSparseForce: true })
  expect(sync.sparseForceStats?.activated).toBe(false)
  sync.solve()
  expect(sync.getOutput()).toEqual(native.getOutput())
  expect(sync.latestVisualization).toEqual(native.latestVisualization)
  expect(sync.stats).toEqual(native.stats)
  expect(sync.sparseForceStats?.sampleNodes).toBe(4)
  expect(sync.sparseForceStats?.kernelCalls).toBeGreaterThanOrEqual(4)
  expect(Object.keys(sync.sparseForceStats!)).toHaveLength(16)
  expect(sync.getConstructorParams()[0]).toMatchObject({ experimentSparseForce: true })
  const controlled = createControlledForceImproveRuntime()
  const resumed = new Pipeline9HighDensityForceImproveSolver({ ...params, experimentSparseForce: true })
  await resumed.solveAsync(controlled.runtime, 0)
  expect(controlled.tasks).toHaveLength(0)
  expect(resumed.sparseForceStats?.activated).toBe(false)
  const prefix = resumed.solveAsync(controlled.runtime, 1)
  expect(controlled.tasks).toHaveLength(1)
  expect(controlled.tasks[0]!.input.experimentSparseForce).toBe(true)
  controlled.tasks[0]!.finish()
  await prefix
  expect(resumed.iterations).toBe(1)
  expect(resumed.sparseForceStats?.sampleNodes).toBe(1)
  const remaining = resumed.solveAsync(controlled.runtime)
  for (const task of controlled.tasks.slice(1).reverse()) task.finish()
  await remaining
  expect(resumed.getOutput()).toEqual(native.getOutput())
  expect(resumed.latestVisualization).toEqual(native.latestVisualization)
  expect(resumed.stats).toEqual(native.stats)
  expect(resumed.sparseForceStats).toEqual(sync.sparseForceStats)
  const runtime = createPipeline9TestRuntime(1)
  try {
    const worker = new Pipeline9HighDensityForceImproveSolver({ ...params, experimentSparseForce: true })
    await worker.solveAsync(runtime)
    expect(worker.getOutput()).toEqual(native.getOutput())
    expect(worker.latestVisualization).toEqual(native.latestVisualization)
    expect(worker.stats).toEqual(native.stats)
    expect(worker.sparseForceStats).toEqual(sync.sparseForceStats)
  } finally {
    await runtime.dispose()
  }
  expect(params).toEqual(before)
})
