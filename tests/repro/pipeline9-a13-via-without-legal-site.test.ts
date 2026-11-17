import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { type Circle, getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("A13 vias sit closer to pads than the declared via clearance", async (): Promise<void> => {
  // The A13 DDR section after Core routes its four data bytes with
  // bus-lanes-solver 0.0.61: 64 remaining connections beside 2,628 obstacles.
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/a13-via-without-site/remaining64.srj.json.gz",
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
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  expect(routedTraces).toHaveLength(64)

  // This board declares 0.1249 mm from traces and vias to other copper.
  expect(input.minTraceToPadEdgeClearance).toBe(0.1249)
  expect(input.minViaEdgeToPadEdgeClearance).toBe(0.1249)
  const drcInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
    drcOptions: { traceClearance: input.minTraceToPadEdgeClearance },
  }
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    import.meta.path,
  )

  // Routed vias closer to a pad than the declared via-to-pad clearance.
  const { errorsWithCenters } = evaluateRelaxedDrc(drcInput)
  const viaPadErrors = errorsWithCenters.filter(
    (error) =>
      error.type === "pcb_pad_pad_clearance_error" &&
      error.message.startsWith("Via"),
  )
  expect(viaPadErrors.length).toBeGreaterThan(0)

  const graphics = convertSrjToGraphicsObject({
    ...input,
    traces: routedTraces,
  })
  graphics.points = []
  graphics.circles = [
    ...(graphics.circles ?? []),
    ...viaPadErrors.map((error): Circle => {
      if (!error.center) {
        throw new Error("Via-to-pad findings must retain their location")
      }
      return {
        center: { x: error.center.x, y: error.center.y },
        radius: 0.7,
        stroke: "#7c3aed",
        fill: "rgba(124, 58, 237, 0.45)",
      }
    }),
  ]
  const caption = `<g data-testid="via-pad-findings"><rect x="12" y="12" width="470" height="44" rx="6" fill="white" stroke="#7c3aed"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="#7c3aed">Vias under ${input.minViaEdgeToPadEdgeClearance} mm from a pad: ${viaPadErrors.length}</text></g>`
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }).replace(
      "</svg>",
      `${caption}</svg>`,
    ),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "via-pad-findings",
    tolerance: 0,
  })
})
