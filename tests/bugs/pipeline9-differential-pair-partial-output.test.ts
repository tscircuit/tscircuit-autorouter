import { expect, test } from "bun:test"
import inputFixture from "../../fixtures/bug-reports/pipeline9-differential-pair-partial-output/input.srj.json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 preserves independent copper after a differential-pair failure", async (): Promise<void> => {
  const input = structuredClone(inputFixture) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })

  // The CAM negative sink is 5 mm closer than the positive sink. AUX
  // (source_trace_0) is a separate resistor-to-resistor connection.
  expect(() => solver.solve()).toThrow(
    "FortyFiveDegreeSimplificationSolver: pair source_trace_1/source_trace_2 produced invalid complete copper",
  )
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.effortCleanupSolver?.solved).toBe(true)
  expect(solver.effortCleanupSolver?.getOutput()).toContainEqual(
    expect.objectContaining({ rootConnectionName: "source_trace_0" }),
  )
  expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow(
    "Cannot get output before solving is complete",
  )

  const routedTraces = solver.getPartialOutputSimplifiedPcbTraces()
  expect(routedTraces.map((trace) => trace.connection_name)).toEqual([
    "source_trace_0",
  ])

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
