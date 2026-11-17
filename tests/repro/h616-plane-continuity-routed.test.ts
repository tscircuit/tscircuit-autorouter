import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getH616PlaneContinuityFixture } from "tests/fixtures/getH616PlaneContinuityFixture"
import { getH616PlaneContinuitySnapshotSvg } from "tests/fixtures/getH616PlaneContinuitySnapshotSvg"

test("routes five H616 plane escapes from bare native pads", async (): Promise<void> => {
  const fixture = getH616PlaneContinuityFixture()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(fixture.srjWithPointPairs, { cacheProvider: null })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  await expect(getH616PlaneContinuitySnapshotSvg({
    inputSrj: fixture.inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })).toMatchSvgSnapshot(import.meta.path)
})
