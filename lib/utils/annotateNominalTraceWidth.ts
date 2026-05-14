import type { GraphicsObject, Line, Rect, Text } from "graphics-debug"
import type { SimpleRouteJson } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

const NOMINAL_TRACE_WIDTH_PALETTE = [
  "#e41a1c",
  "#377eb8",
  "#4daf4a",
  "#984ea3",
  "#ff7f00",
  "#a65628",
  "#f781bf",
  "#999999",
]

const MATCH_TOLERANCE = 1e-6

const endpointsMatch = (
  line: Line,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): boolean => {
  if (!line.points || line.points.length < 2) return false
  const lp1 = line.points[0]!
  const lp2 = line.points[line.points.length - 1]!
  const forward =
    Math.abs(lp1.x - p1.x) < MATCH_TOLERANCE &&
    Math.abs(lp1.y - p1.y) < MATCH_TOLERANCE &&
    Math.abs(lp2.x - p2.x) < MATCH_TOLERANCE &&
    Math.abs(lp2.y - p2.y) < MATCH_TOLERANCE
  const backward =
    Math.abs(lp1.x - p2.x) < MATCH_TOLERANCE &&
    Math.abs(lp1.y - p2.y) < MATCH_TOLERANCE &&
    Math.abs(lp2.x - p1.x) < MATCH_TOLERANCE &&
    Math.abs(lp2.y - p1.y) < MATCH_TOLERANCE
  return forward || backward
}

/**
 * Recolors trace wire segments in `graphics` by their connection's
 * `nominalTraceWidth` and appends a legend to the side of `srj.bounds`.
 *
 * Returns a new GraphicsObject; the input is not mutated.
 */
export const annotateNominalTraceWidth = (
  graphics: GraphicsObject,
  srj: SimpleRouteJson,
): GraphicsObject => {
  const connectionNominalWidth = new Map<string, number>()
  for (const connection of srj.connections) {
    if (connection.nominalTraceWidth !== undefined) {
      connectionNominalWidth.set(connection.name, connection.nominalTraceWidth)
    }
  }

  const usedWidths = new Set<number>()
  if (srj.traces) {
    for (const trace of srj.traces) {
      const w = connectionNominalWidth.get(trace.connection_name)
      if (w !== undefined) usedWidths.add(w)
    }
  }
  const sortedWidths = Array.from(usedWidths).sort((a, b) => a - b)
  const widthColorMap = new Map<number, string>()
  sortedWidths.forEach((w, i) => {
    widthColorMap.set(
      w,
      NOMINAL_TRACE_WIDTH_PALETTE[i % NOMINAL_TRACE_WIDTH_PALETTE.length]!,
    )
  })

  const updatedLines: Line[] = (graphics.lines ?? []).map((line) => ({
    ...line,
  }))

  if (srj.traces) {
    for (const trace of srj.traces) {
      const nominalWidth = connectionNominalWidth.get(trace.connection_name)
      if (nominalWidth === undefined) continue
      const color = widthColorMap.get(nominalWidth)
      if (!color) continue

      for (let j = 0; j < trace.route.length - 1; j++) {
        const a = trace.route[j]!
        const b = trace.route[j + 1]!
        if (
          a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer !== b.layer
        ) {
          continue
        }
        const expectedLayer = `z${mapLayerNameToZ(a.layer, srj.layerCount)}`
        const p1 = { x: a.x, y: a.y }
        const p2 = { x: b.x, y: b.y }
        for (const line of updatedLines) {
          if (line.layer !== expectedLayer) continue
          if (endpointsMatch(line, p1, p2)) {
            line.strokeColor = color
          }
        }
      }
    }
  }

  const rects: Rect[] = [...(graphics.rects ?? [])]
  const texts: Text[] = [...(graphics.texts ?? [])]

  if (sortedWidths.length > 0) {
    const boundsWidth = srj.bounds.maxX - srj.bounds.minX
    const boundsHeight = srj.bounds.maxY - srj.bounds.minY
    const refSize = Math.max(boundsWidth, boundsHeight)
    const swatchSize = refSize * 0.03
    const rowSpacing = swatchSize * 1.8
    const padding = refSize * 0.04
    const legendLeftX = srj.bounds.maxX + padding
    const headerY = srj.bounds.maxY
    const fontSize = swatchSize * 0.9

    texts.push({
      x: legendLeftX,
      y: headerY,
      text: "nominalTraceWidth",
      anchorSide: "top_left",
      fontSize,
      color: "black",
    })

    sortedWidths.forEach((w, i) => {
      const rowCenterY = headerY - rowSpacing * (i + 1) - swatchSize * 0.5
      const swatchCenterX = legendLeftX + swatchSize * 0.5
      rects.push({
        center: { x: swatchCenterX, y: rowCenterY },
        width: swatchSize,
        height: swatchSize,
        fill: widthColorMap.get(w)!,
        stroke: "black",
      })
      texts.push({
        x: legendLeftX + swatchSize * 1.4,
        y: rowCenterY,
        text: String(w),
        anchorSide: "center_left",
        fontSize,
        color: "black",
      })
    })
  }

  return {
    ...graphics,
    lines: updatedLines,
    rects,
    texts,
  }
}
