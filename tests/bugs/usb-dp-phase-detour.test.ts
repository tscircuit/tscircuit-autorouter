import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import input from "../fixtures/bug-reports/usb-dp-phase-detour/input.json"

test("preserves preloaded traces while routing the full MIDI keyboard", async (): Promise<void> => {
  const srj: SimpleRouteJson = structuredClone(input)
  const originalTraces = structuredClone(srj.traces!)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    effort: 1,
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.solved).toBeTrue()
  const output = solver.getOutputSimpleRouteJson()
  for (const originalTrace of originalTraces) {
    expect(
      output.traces!.find(
        (trace) => trace.pcb_trace_id === originalTrace.pcb_trace_id,
      ),
    ).toEqual(originalTrace)
  }
  const drcInput = {
    inputSrj: output,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: [],
    includeBoardClearance: true,
  }
  expect(evaluateRelaxedDrc(drcInput).errors).toEqual([])
  let svgName: string | undefined
  if (process.platform === "linux") svgName = "linux"
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName },
  )
})
