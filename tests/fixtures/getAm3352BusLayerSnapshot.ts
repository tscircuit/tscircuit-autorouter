import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { isPointInRect } from "lib/utils/isPointInRect"

type SnapshotInput = {
  srj: SimpleRouteJson
  traces: SimplifiedPcbTraces
  stage: "before" | "after"
  illegalRouteCount: number
  drcCount: number
  connectedSignals: number
  zoom: boolean
}

/** Crop drawing primitives only; all routing and checks use the complete board. */
export function getAm3352BusLayerGraphics(input: SnapshotInput): GraphicsObject {
  const graphics = convertSrjToGraphicsObject({ ...input.srj, traces: input.traces })
  graphics.points = []
  if (input.zoom) {
    const view = { center: { x: 0, y: -10 }, width: 32, height: 38 }
    graphics.rects = graphics.rects.filter((rect) => isPointInRect(rect.center, view))
    graphics.circles = graphics.circles.filter((circle) => isPointInRect(circle.center, view))
    graphics.lines = graphics.lines.flatMap((line) =>
      line.points.slice(0, -1).flatMap((point, index) => {
        const next = line.points[index + 1]!
        if (!isPointInRect(point, view) || !isPointInRect(next, view)) return []
        return [{ ...line, points: [point, next] }]
      }),
    )
  }
  return graphics
}

export function getAm3352BusLayerSnapshot(input: SnapshotInput): string {
  const svg = getSvgFromGraphicsObject(getAm3352BusLayerGraphics(input), { backgroundColor: "white" })
  const color = input.illegalRouteCount === 0 && input.drcCount === 0 ? "#166534" : "#b91c1c"
  const title = `AM3352 DDR — ${input.stage} layer routing`
  const summary = `Illegal-layer routes: ${input.illegalRouteCount} | Relaxed DRC: ${input.drcCount} | Connected signals: ${input.connectedSignals}/47`
  const header = `<g data-testid="am3352-layer-routing-summary"><rect x="12" y="12" width="616" height="76" rx="6" fill="white" stroke="${color}"/><text x="24" y="37" font-family="Arial, sans-serif" font-size="20" fill="${color}">${title}</text><text x="24" y="59" font-family="Arial, sans-serif" font-size="14" fill="${color}">${summary}</text><text x="24" y="78" font-family="Arial, sans-serif" font-size="12" fill="#444">Layers: top red · inner1 green (excluded) · inner2 yellow · bottom blue</text></g>`
  // Keep annotations outside the board viewport so pads are never obscured.
  return `<svg width="640" height="738" viewBox="0 0 640 738" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>${header}<g transform="translate(0 98)">${svg}</g></svg>`
}
