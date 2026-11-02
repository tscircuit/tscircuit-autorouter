import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import input from "../../fixtures/bug-reports/compact-pir-relaxed-drc/input.srj.json"

test("compact PIR full-board relaxed DRC regression", async (): Promise<void> => {
  const inputSrj = input as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(inputSrj),
    { effort: 1, cacheProvider: null },
  )
  solver.solve()

  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.solved).toBe(true)
  const drcInput = {
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  const viaCount = drcInput.routedTraces.reduce(
    (count, trace) =>
      count + trace.route.filter((point) => point.route_type === "via").length,
    0,
  )
  expect(drcInput.routedTraces).toHaveLength(87)
  expect(viaCount).toBe(92)
  expect(evaluateRelaxedDrc(drcInput).errors).toHaveLength(24)
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
