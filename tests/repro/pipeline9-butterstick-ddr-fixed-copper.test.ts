import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

// Native board: https://github.com/butterstick-fpga/butterstick-hardware/blob/0694ddfa9824a07f0c6c6981186e45f80187659c/hardware/ButterStick_r1.0/ButterStick.kicad_pcb

test("routes ButterStick DDR beside completed data-byte copper", async (): Promise<void> => {
  const fixtureUrl = new URL(
    "../fixtures/assets/butterstick-ddr-fixed-copper.srj.json.gz",
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

  // Include the completed data-byte copper in both the drawing and physical checks.
  const referenceSrj = {
    ...inputSrj,
    connections: [...preloadedConnections, ...inputSrj.connections],
    traces: preloadedTraces,
  }
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: referenceSrj,
      srjWithPointPairs: {
        ...solver.srjWithPointPairs!,
        connections: [
          ...preloadedConnections,
          ...solver.srjWithPointPairs!.connections,
        ],
      },
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
      drcOptions: { traceClearance: 0.0889, viaToPadClearance: 0.1 },
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
