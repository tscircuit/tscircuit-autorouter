import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("routes native H616 control signals beside completed DDR data bytes", async (): Promise<void> => {
  // Fresh Core 0.0.2436 handoff from the real TSX board, with native fixed paths.
  const { inputSrj, preloadedConnections } = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "../fixtures/assets/h616-native-fixed-trace-force.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  ) as {
    inputSrj: SimpleRouteJson
    preloadedConnections: SimpleRouteJson["connections"]
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
  }
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: referenceSrj,
      srjWithPointPairs: referenceSrj,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
      drcOptions: { traceClearance: 0.1, viaToPadClearance: 0.1 },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
