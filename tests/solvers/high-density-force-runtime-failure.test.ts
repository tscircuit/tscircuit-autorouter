import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { Pipeline9HighDensityForceImproveSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { createHighDensityForceImproveRuntimeFixture } from "../fixtures/createHighDensityForceImproveRuntimeFixture"
import { createControlledForceImproveRuntime } from "../fixtures/createControlledForceImproveRuntime"
import { expectHighDensityForceImproveState } from "../fixtures/expectHighDensityForceImproveState"

test("a later worker error waits for its serial prefix and never publishes later jobs", async (): Promise<void> => {
  const baseline = new HighDensityForceImproveSolver(
    createHighDensityForceImproveRuntimeFixture(),
  )
  const solver = new Pipeline9HighDensityForceImproveSolver(
    createHighDensityForceImproveRuntimeFixture(),
  )
  const { runtime, tasks } = createControlledForceImproveRuntime()
  const pending = solver.solveAsync(runtime).then(
    (): unknown => undefined,
    (error: unknown): unknown => error,
  )
  expect(tasks).toHaveLength(4)
  tasks[2]!.reject(new Error("later force worker failed"))
  tasks[3]!.finish()
  await Promise.resolve()
  await Promise.resolve()
  expectHighDensityForceImproveState(solver, baseline)
  await expect(solver.solveAsync()).rejects.toThrow("already running")
  tasks[0]!.finish()
  await Promise.resolve()
  await Promise.resolve()
  baseline.step()
  expectHighDensityForceImproveState(solver, baseline)
  tasks[1]!.finish()
  expect(String(await pending)).toContain("later force worker failed")
  baseline.step()
  expect(solver.getOutput()).toStrictEqual(baseline.getOutput())
  expect([...solver.improvedRoutesByIndex]).toStrictEqual([
    ...baseline.improvedRoutesByIndex,
  ])
  expect(solver.latestVisualization).toStrictEqual(baseline.latestVisualization)
  expect(solver.stats).toStrictEqual(baseline.stats)
  expect(solver.iterations).toBe(2)
  expect(solver.activeSampleIndex).toBe(2)
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toContain("later force worker failed")
  expect(solver.improvedRoutesByIndex.has(3)).toBe(false)
  expect(solver.improvedRoutesByIndex.has(5)).toBe(false)
})
