import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import {
  endcapClearance,
  getRetainedTraceEndcapGap,
  getRetainedTraceEndcapInput,
} from "tests/fixtures/retainedTraceEndcaps"

test("Pipeline 4 retains clearance beside the narrower wire control", async () => {
  const inputSrj = getRetainedTraceEndcapInput(0.4)
  const solver = new AutoroutingPipelineSolver4(inputSrj, {
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
  await expect(getBugReportSnapshotSvg(evaluation)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
