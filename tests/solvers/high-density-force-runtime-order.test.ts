import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { Pipeline9HighDensityForceImproveSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { createHighDensityForceImproveRuntimeFixture } from "../fixtures/createHighDensityForceImproveRuntimeFixture"
import { createControlledForceImproveRuntime } from "../fixtures/createControlledForceImproveRuntime"
import { expectHighDensityForceImproveState } from "../fixtures/expectHighDensityForceImproveState"

test("reverse-completing force jobs publish only in original sample order", async (): Promise<void> => {
  const params = createHighDensityForceImproveRuntimeFixture()
  const baseline = new HighDensityForceImproveSolver(structuredClone(params))
  const solver = new Pipeline9HighDensityForceImproveSolver(structuredClone(params))
  const { runtime, tasks } = createControlledForceImproveRuntime()
  const pending = solver.solveAsync(runtime)
  expect(tasks).toHaveLength(4)
  expect(
    tasks.map(
      (task): string => task.input.nodeWithPortPoints[0]!.capacityMeshNodeId,
    ),
  ).toEqual([
    "force-node-2",
    "force-node-0",
    "force-node-3",
    "force-node-1",
  ])
  tasks[3]!.finish()
  tasks[2]!.finish()
  tasks[1]!.finish()
  await Promise.resolve()
  await Promise.resolve()
  expectHighDensityForceImproveState(solver, baseline)
  tasks[0]!.finish()
  await pending
  baseline.solve()
  expectHighDensityForceImproveState(solver, baseline)
  expect([...solver.improvedRoutesByIndex.keys()]).toEqual([0, 2, 1, 6, 3, 5])
})
