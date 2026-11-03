import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import {
  getRetainedTraceEndcapGap,
  getRetainedTraceEndcapInput,
} from "tests/fixtures/retainedTraceEndcaps"

test("repro: Pipeline 4 routes through a retained wide wire end cap", async () => {
  const inputSrj = getRetainedTraceEndcapInput()
  const before = structuredClone(inputSrj)
  const solver = new AutoroutingPipelineSolver4(inputSrj, { cacheProvider: null })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const evaluation = {
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  }
  expect(getRetainedTraceEndcapGap(evaluation)).toBeCloseTo(-0.15, 8)
  const drc = evaluateRelaxedDrc(evaluation)
  expect(drc.errors).toHaveLength(1)
  expect(drc.errors[0]).toMatchObject({
    pcb_trace_error_id: "overlap_fixed_SIGNAL_0",
  })
  expect(inputSrj).toEqual(before)
  await expect(getBugReportSnapshotSvg(evaluation)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
