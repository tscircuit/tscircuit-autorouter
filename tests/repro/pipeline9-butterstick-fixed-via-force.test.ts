import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { replaceNativePcbTraces } from "tests/fixtures/replaceNativePcbTraces"

type ButterStickFixture = {
  input: SimpleRouteJson
  options: { cacheProvider: null }
  circuitJson: AnyCircuitElement[]
}

test("route ButterStick DDR controls beside completed data-byte vias", async (): Promise<void> => {
  const fixture: ButterStickFixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/butterstick-fixed-via-force.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    fixture.input,
    fixture.options,
  )
  solver.solve()
  expect(solver.solved).toBeTrue()
  const traces = solver.getOutputSimplifiedPcbTraces()
  const circuitJson = replaceNativePcbTraces({
    circuitJson: fixture.circuitJson,
    srj: fixture.input,
    traces,
  })
  // Keep the native pads and the completed data-byte copper in the board view.
  const svg = convertCircuitJsonToPcbSvg(circuitJson, {
    width: 1400,
    height: 1000,
    backgroundColor: "white",
    includeVersion: false,
    renderSolderMask: false,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path, {
    svgName: process.arch,
    scale: 1,
  })
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: fixture.input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
      includeBoardClearance: true,
      drcOptions: {
        traceClearance: fixture.input.minTraceToPadEdgeClearance,
        viaToPadClearance: fixture.input.minViaEdgeToPadEdgeClearance,
      },
    }),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: `${process.arch}-drc`,
    scale: 1,
  })
})
