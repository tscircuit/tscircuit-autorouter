import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("routes the H616 DDR board beside completed data-byte copper", async (): Promise<void> => {
  const fixtureUrl = new URL(
    "../fixtures/assets/h616-native-ddr-clearance.srj.json.gz",
    import.meta.url,
  )
  const { inputSrj, preloadedConnections, preloadedTraces } = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(fixtureUrl))).toString("utf8"),
  ) as {
    inputSrj: SimpleRouteJson
    preloadedConnections: SimpleRouteJson["connections"]
    preloadedTraces: SimplifiedPcbTrace[]
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()

  const referenceSrj = {
    ...inputSrj,
    connections: [...preloadedConnections, ...inputSrj.connections],
    traces: preloadedTraces,
  }
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: referenceSrj,
      srjWithPointPairs: referenceSrj,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
      // Preserve the native H616 board's 0.1 mm copper clearance.
      drcOptions: { traceClearance: 0.1, viaToPadClearance: 0.1 },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
