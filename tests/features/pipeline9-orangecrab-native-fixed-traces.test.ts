import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import srj from "../fixtures/orangecrab-native-fixed-traces.srj.json"

test("OrangeCrab routes controls beside saved DDR paths", async (): Promise<void> => {
  const input = srj as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(input),
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.solved).toBeTrue()
  const output = solver.getOutputSimpleRouteJson()
  const savedIds = new Set(input.traces!.map((trace) => trace.pcb_trace_id))
  const savedTraces = output.traces!.filter((trace) =>
    savedIds.has(trace.pcb_trace_id),
  )
  expect(savedTraces).toEqual(input.traces!)
  const drcInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    drcOptions: {
      traceClearance: input.minTraceToPadEdgeClearance,
      viaClearance: input.minPadEdgeToPadEdgeClearance,
      viaToPadClearance: input.minViaEdgeToPadEdgeClearance,
      holeClearance: input.minTraceToHoleEdgeClearance,
    },
  }
  expect(evaluateRelaxedDrc(drcInput).errors).toHaveLength(0)
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
