import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"

function readH3Srj(filename: string): SimpleRouteJson {
  const compressed = readFileSync(
    new URL(
      `../../fixtures/features/h3-ddr-strobe-via-access/${filename}.srj.json.gz`,
      import.meta.url,
    ),
  )
  return JSON.parse(gunzipSync(new Uint8Array(compressed)).toString("utf8"))
}

test("H3 DQS1+ escapes beside sixteen fixed data routes", async (): Promise<void> => {
  const inputSrj = readH3Srj("input")
  const routedDqSrj = readH3Srj("routed-data")
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  solver.solve()
  let routedTraces: SimplifiedPcbTraces = []
  if (solver.solved) routedTraces = solver.getOutputSimplifiedPcbTraces()

  const referenceSrj = {
    ...routedDqSrj,
    connections: [...routedDqSrj.connections, ...inputSrj.connections],
  }
  const snapshotInput = {
    inputSrj: referenceSrj,
    srjWithPointPairs: referenceSrj,
    routedTraces,
    drcOptions: { traceClearance: 0.0889, viaToPadClearance: 0.0889 },
  }
  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
  expect(evaluateRelaxedDrc(snapshotInput).errors).toEqual([])
})
