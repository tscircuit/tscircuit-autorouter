import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("routes H616 DDR controls beside completed data-byte copper", async (): Promise<void> => {
  const fixtureUrl = new URL(
    "../fixtures/assets/h616-full-board-ddr-clearance.json.gz",
    import.meta.url,
  )
  const fixture = JSON.parse(
    gunzipSync(new Uint8Array(readFileSync(fixtureUrl))).toString("utf8"),
  ) as {
    inputSrj: SimpleRouteJson
    preloadedConnections: SimpleRouteJson["connections"]
    preloadedTraces: SimplifiedPcbTrace[]
    nativeObstacles: SimpleRouteJson["obstacles"]
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.inputSrj,
    { cacheProvider: null },
  )
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()

  const referenceSrj = {
    ...fixture.inputSrj,
    obstacles: fixture.nativeObstacles,
    connections: [
      ...fixture.preloadedConnections,
      ...fixture.inputSrj.connections,
    ],
    traces: fixture.preloadedTraces,
  }
  const snapshotInput = {
    inputSrj: referenceSrj,
    srjWithPointPairs: {
      ...solver.srjWithPointPairs!,
      connections: [
        ...fixture.preloadedConnections,
        ...solver.srjWithPointPairs!.connections,
      ],
    },
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    // Preserve the native board's 0.1 mm copper clearance.
    drcOptions: { traceClearance: 0.1, viaToPadClearance: 0.1 },
  }
  expect(evaluateRelaxedDrc(snapshotInput).errors.length).toBeLessThan(50)
  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
