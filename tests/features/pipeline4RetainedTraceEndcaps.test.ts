import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import {
  endcapClearance,
  getRetainedTraceEndcapGap,
  getRetainedTraceEndcapInput,
} from "tests/fixtures/retainedTraceEndcaps"

test("Pipeline 4 clears retained wire end caps with rectangular obstacles", async () => {
  const inputSrj = getRetainedTraceEndcapInput()
  const before = structuredClone(inputSrj)
  const solver = new AutoroutingPipelineSolver4(inputSrj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const evaluation = {
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  }
  expect(getRetainedTraceEndcapGap(evaluation)).toBeGreaterThanOrEqual(
    endcapClearance,
  )
  const drc = evaluateRelaxedDrc(evaluation)
  expect(drc.errors).toEqual([])
  expect(inputSrj).toEqual(before)
  await expect(getBugReportSnapshotSvg(evaluation)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
