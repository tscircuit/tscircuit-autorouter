import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { type Circle, getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("A13 routed traces keep the declared clearance from each other", async (): Promise<void> => {
  // The real A13 DDR section after Core routes the four data bytes: 64
  // remaining connections, with the byte copper as 2,603 fixed obstacles.
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/a13-fixed-copper/remaining64.srj.json.gz",
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

  // This board declares 0.1249 mm between traces and other copper. Check
  // that rule, not the 0.1 mm benchmark default.
  const declaredClearance = input.minTraceToPadEdgeClearance
  expect(declaredClearance).toBe(0.1249)
  const drcInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
    drcOptions: { traceClearance: declaredClearance },
  }
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    import.meta.path,
  )

  // Two routed traces that do not touch but sit closer than the declared
  // clearance. Copper touching the pads of the two enclosed DM balls is a
  // separate finding and stays in the count above.
  const { errorsWithCenters } = evaluateRelaxedDrc(drcInput)
  expect(errorsWithCenters.length).toBeLessThanOrEqual(7)
  const closeTracePairs = errorsWithCenters.filter(
    (error) => error.type === "pcb_trace_error" && /gap: /.test(error.message),
  )
  expect(closeTracePairs).toEqual([])

  const graphics = convertSrjToGraphicsObject({
    ...input,
    traces: routedTraces,
  })
  graphics.points = []
  graphics.circles = [
    ...(graphics.circles ?? []),
    ...closeTracePairs.map((error): Circle => {
      if (!error.center) {
        throw new Error("Close trace pairs must retain their location")
      }
      return {
        center: { x: error.center.x, y: error.center.y },
        radius: 0.7,
        stroke: "#7c3aed",
        fill: "rgba(124, 58, 237, 0.45)",
      }
    }),
  ]
  const caption = `<g data-testid="close-trace-pairs"><rect x="12" y="12" width="430" height="44" rx="6" fill="white" stroke="#7c3aed"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="#7c3aed">Trace pairs under ${declaredClearance} mm: ${closeTracePairs.length}</text></g>`
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }).replace(
      "</svg>",
      `${caption}</svg>`,
    ),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "close-trace-pairs",
    tolerance: 0,
  })
})
