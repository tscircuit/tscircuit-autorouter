import { getSvgFromGraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { isPointInRect } from "lib/utils/isPointInRect"

/** Crop only the drawing; routing and the reported checks use the whole input. */
export function getA64Byte0EscapeSnapshotSvg({
  inputSrj,
  routedTraces,
  drcCount,
  drillOverlapCount,
}: {
  inputSrj: SimpleRouteJson
  routedTraces: SimplifiedPcbTrace[]
  drcCount: number
  drillOverlapCount: number
}): string {
  const view = {
    center: { x: 132.4, y: -85.4 },
    width: 3.2,
    height: 2.5,
  }
  const graphics = convertSrjToGraphicsObject({
    ...inputSrj,
    traces: routedTraces,
  })
  graphics.points = []
  graphics.rects = graphics.rects.filter((rect) =>
    isPointInRect(rect.center, view),
  )
  graphics.circles = graphics.circles.filter((circle) =>
    isPointInRect(circle.center, view),
  )
  graphics.lines = graphics.lines.flatMap((line) =>
    line.points.slice(0, -1).flatMap((point, index) => {
      const next = line.points[index + 1]!
      if (!isPointInRect(point, view) || !isPointInRect(next, view)) return []
      return [{ ...line, points: [point, next] }]
    }),
  )
  const svg = getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })
  const color = drillOverlapCount === 0 ? "#166534" : "#b91c1c"
  const summary = `<g data-testid="a64-whole-sample-checks"><rect x="12" y="12" width="480" height="68" rx="6" fill="white" stroke="${color}"/><text x="24" y="38" font-family="Arial, sans-serif" font-size="18" font-weight="600" fill="${color}">Whole sample source-clearance DRC: ${drcCount}</text><text x="24" y="64" font-family="Arial, sans-serif" font-size="18" font-weight="600" fill="${color}">Direct drill/pad overlaps: ${drillOverlapCount}</text></g>`
  return svg.replace("</svg>", `${summary}</svg>`)
}
