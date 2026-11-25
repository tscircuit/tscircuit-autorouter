import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  type Circle,
  type GraphicsObject,
  getSvgFromGraphicsObject,
  type Line,
} from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

// Clip one segment to the frame (Liang-Barsky); null when it misses the frame.
const clipSegment = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  frame: Bounds,
): [{ x: number; y: number }, { x: number; y: number }] | null => {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  for (const [p, q] of [
    [-dx, a.x - frame.minX],
    [dx, frame.maxX - a.x],
    [-dy, a.y - frame.minY],
    [dy, frame.maxY - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    const r = q / p
    if (p < 0) t0 = Math.max(t0, r)
    else t1 = Math.min(t1, r)
    if (t0 > t1) return null
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ]
}

// Traces are clipped to the frame; pads, vias and markers are kept only when
// they lie wholly inside it, so every render of the frame has the same extent.
const getFrameGraphics = (
  graphics: GraphicsObject,
  frame: Bounds,
): GraphicsObject => {
  const isInside = (box: Bounds): boolean =>
    box.minX >= frame.minX &&
    box.maxX <= frame.maxX &&
    box.minY >= frame.minY &&
    box.maxY <= frame.maxY
  const lines: Line[] = (graphics.lines ?? []).flatMap((line) =>
    line.points.slice(1).flatMap((point, index) => {
      const segment = clipSegment(line.points[index]!, point, frame)
      return segment ? [{ ...line, points: segment }] : []
    }),
  )
  return {
    ...graphics,
    lines,
    rects: (graphics.rects ?? []).filter((rect) => {
      const radians = ((rect.ccwRotationDegrees ?? 0) * Math.PI) / 180
      const cos = Math.abs(Math.cos(radians))
      const sin = Math.abs(Math.sin(radians))
      const halfWidth = (rect.width / 2) * cos + (rect.height / 2) * sin
      const halfHeight = (rect.width / 2) * sin + (rect.height / 2) * cos
      return isInside({
        minX: rect.center.x - halfWidth,
        maxX: rect.center.x + halfWidth,
        minY: rect.center.y - halfHeight,
        maxY: rect.center.y + halfHeight,
      })
    }),
    circles: (graphics.circles ?? []).filter((circle) =>
      isInside({
        minX: circle.center.x - circle.radius,
        maxX: circle.center.x + circle.radius,
        minY: circle.center.y - circle.radius,
        maxY: circle.center.y + circle.radius,
      }),
    ),
    polygons: [],
    texts: [],
    arrows: [],
    infiniteLines: [],
  }
}

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
  expect(viaPadErrors).toEqual([])

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

  // The same 5 x 4 mm frame around the via west of the DDR fanout.
  const frame: Bounds = { minX: -9.04, maxX: -4.04, minY: -3.74, maxY: 0.26 }
  const frameFindings = viaPadErrors.filter(
    (error) =>
      error.center!.x >= frame.minX &&
      error.center!.x <= frame.maxX &&
      error.center!.y >= frame.minY &&
      error.center!.y <= frame.maxY,
  )
  expect(frameFindings).toEqual([])
  const frameGraphics = getFrameGraphics(graphics, frame)
  frameGraphics.rects = [
    ...(frameGraphics.rects ?? []),
    {
      center: {
        x: (frame.minX + frame.maxX) / 2,
        y: (frame.minY + frame.maxY) / 2,
      },
      width: frame.maxX - frame.minX,
      height: frame.maxY - frame.minY,
      stroke: "#94a3b8",
    },
  ]
  // The caption sits in its own band above the drawing.
  const frameSvg = getSvgFromGraphicsObject(frameGraphics, {
    backgroundColor: "white",
    svgWidth: 640,
    svgHeight: 512,
  }).replace("<svg ", '<svg x="0" y="68" ')
  const framedDetail = `<svg width="640" height="580" viewBox="0 0 640 580" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><g data-testid="frame-via-pad-findings"><rect x="12" y="12" width="616" height="44" rx="6" fill="white" stroke="#7c3aed"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" font-weight="600" fill="#7c3aed">5 x 4 mm detail: via-to-pad findings under ${input.minViaEdgeToPadEdgeClearance} mm: ${frameFindings.length}</text></g>${frameSvg}</svg>`
  await expect(framedDetail).toMatchSvgSnapshot(import.meta.path, {
    svgName: "via-pad-detail",
    tolerance: 0,
  })
})
