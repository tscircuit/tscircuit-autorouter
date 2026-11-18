import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { createPcbBoardElement } from "lib/utils/convertToCircuitJson"

test("route the native A13 remaining signals after the four data phases", async (): Promise<void> => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/a13-fixed-copper/remaining64-bus060.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const snapshotInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  await expect(
    getBugReportSnapshotSvg({
      ...snapshotInput,
      drcOptions: {
        traceClearance: input.minTraceToPadEdgeClearance,
        viaToPadClearance: input.minViaEdgeToPadEdgeClearance,
      },
    }),
  ).toMatchSvgSnapshot(import.meta.path)

  // Render the physical round pad at RAM BALL_C3, not its SRJ bounding box.
  const { circuitJson } = evaluateRelaxedDrc(snapshotInput)
  const svg = convertCircuitJsonToPcbSvg(
    [
      ...circuitJson,
      {
        ...createPcbBoardElement(input),
        center: { x: -5.6, y: 3.464194 },
        width: 2.4,
        height: 2.4,
        outline: undefined,
      },
    ],
    {
      width: 1000,
      height: 1000,
      backgroundColor: "white",
      renderSolderMask: false,
      layer: "top",
      drawPaddingOutsideBoard: false,
      shouldDrawErrors: false,
      shouldDrawRatsNest: false,
      includeVersion: false,
    },
  )
  await expect(svg).toMatchSvgSnapshot(import.meta.path, {
    svgName: "copper-contacts",
    scale: 1,
  })
})
