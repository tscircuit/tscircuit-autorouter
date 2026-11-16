import { expect, test } from "bun:test"
import srjJson from "dataset-srj18/samples/sample009.json"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("routes the complete GMSL serializer board with layer-aware net pairing", async (): Promise<void> => {
  const input = structuredClone(srjJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const snapshotInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  expect(evaluateRelaxedDrc(snapshotInput).errors).toHaveLength(0)
  const viaCount = snapshotInput.routedTraces
    .flatMap((trace) => trace.route)
    .filter((point) => point.route_type === "via").length
  expect(viaCount).toBe(118)
  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
