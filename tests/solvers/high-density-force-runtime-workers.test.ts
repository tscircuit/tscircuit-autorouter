import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { Pipeline9HighDensityForceImproveSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import { createHighDensityForceImproveRuntimeFixture } from "../fixtures/createHighDensityForceImproveRuntimeFixture"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"
import { expectHighDensityForceImproveState } from "../fixtures/expectHighDensityForceImproveState"

test("force workers preserve actual numerical improvements and complete serial public state", async (): Promise<void> => {
  const params = createHighDensityForceImproveRuntimeFixture()
  const unchangedInput = structuredClone(params)
  const baseline = new HighDensityForceImproveSolver(structuredClone(params))
  baseline.solve()
  expect(baseline.getOutput()[0]!.route[2]!.y).toBe(0.468)
  expect(baseline.getOutput()).not.toEqual(params.hdRoutes)
  expect(
    baseline.sampleEntries.map(
      (entry): string => entry.node.capacityMeshNodeId,
    ),
  ).toEqual([
    "force-node-2",
    "force-node-0",
    "force-node-3",
    "force-node-1",
  ])
  expect(baseline.getOutput()[4]).toStrictEqual(params.hdRoutes[4])
  expect(baseline.getOutput()[3]!.vias).toHaveLength(1)
  for (const workerCount of [1, 4]) {
    const runtime = createPipeline9TestRuntime(workerCount)
    try {
      const solver = new Pipeline9HighDensityForceImproveSolver(params)
      await solver.solveAsync(runtime)
      expectHighDensityForceImproveState(solver, baseline)
      expect(solver.getOutput()[0]!.route[0]).toEqual(
        params.hdRoutes[0]!.route[0],
      )
      expect(solver.getOutput()[0]!.route.at(-1)).toEqual(
        params.hdRoutes[0]!.route.at(-1),
      )
      expect(params).toStrictEqual(unchangedInput)
    } finally {
      await runtime.dispose()
    }
  }
})
