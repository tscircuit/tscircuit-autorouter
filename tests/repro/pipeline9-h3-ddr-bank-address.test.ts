import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

function readH3Srj(filename: string): SimpleRouteJson {
  const compressed = readFileSync(
    new URL(
      `../../fixtures/features/h3-ddr-bank-address/${filename}.srj.json.gz`,
      import.meta.url,
    ),
  )
  return JSON.parse(gunzipSync(new Uint8Array(compressed)).toString("utf8"))
}

test("H3 BA1 escapes beside sixteen fixed data routes", async (): Promise<void> => {
  const inputSrj = readH3Srj("input")
  const routedDqSrj = readH3Srj("routed-data")
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()

  const referenceSrj = {
    ...routedDqSrj,
    connections: [...routedDqSrj.connections, ...inputSrj.connections],
  }
  const snapshotInput = {
    inputSrj: referenceSrj,
    srjWithPointPairs: referenceSrj,
    routedTraces,
    // Preserve the native board's 0.0889 mm clearance.
    drcOptions: { traceClearance: 0.0889, viaToPadClearance: 0.0889 },
  }
  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
