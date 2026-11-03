import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import {
  endcapClearance,
  getRetainedTraceEndcapGap,
  getRetainedTraceEndcapInput,
} from "tests/fixtures/retainedTraceEndcaps"

test("default Pipeline 9 clears the same retained wide wire", async () => {
  const inputSrj = getRetainedTraceEndcapInput()
  const before = structuredClone(inputSrj)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const evaluation = {
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  expect(getRetainedTraceEndcapGap(evaluation)).toBeGreaterThanOrEqual(
    endcapClearance,
  )
  expect(evaluateRelaxedDrc(evaluation).errors).toEqual([])
  expect(inputSrj).toEqual(before)
  await expect(getBugReportSnapshotSvg(evaluation)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
