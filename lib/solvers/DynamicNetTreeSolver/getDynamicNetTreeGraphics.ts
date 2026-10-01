import type { GraphicsObject } from "graphics-debug"
import type { SimplifiedPcbTrace } from "../../types"
import { getGraphicsLayerFromLayerNames } from "../../utils/getGraphicsObjectLayer"
import type { DynamicNetTreeProblem } from "./routeDynamicNetTree"

/** Physical copper and the current proposed branches; no schematic animation. */
export function getDynamicNetTreeGraphics(
  problem: DynamicNetTreeProblem,
  traces: SimplifiedPcbTrace[],
  label: string,
  step: number,
): GraphicsObject {
  const graphics: GraphicsObject = {
    lines: [],
    circles: [],
    rects: [],
    points: [],
    texts: [],
  }
  graphics.lines!.push({
    points: [...problem.outline, problem.outline[0]!],
    strokeColor: "#64748b",
    strokeWidth: 0.05,
    step,
  })
  for (const c of problem.copper) {
    const layer = getGraphicsLayerFromLayerNames(
      c.layers.map((z) => (z === 0 ? "top" : "bottom")),
      2,
    )
    const color = c.owner === problem.net ? "#15803d" : "#94a3b8"
    if (c.rectangle)
      graphics.rects!.push({
        center: c.start,
        width: c.rectangle.width,
        height: c.rectangle.height,
        ccwRotationDegrees: (c.rectangle.rotation * 180) / Math.PI,
        fill: color,
        layer,
        step,
      })
    else if (c.kind === "wire")
      graphics.lines!.push({
        points: [c.start, c.end],
        strokeWidth: c.radius * 2,
        strokeColor: color,
        layer,
        step,
        strokeDash: c.layers[0] === 1 ? "0.15 0.1" : undefined,
      })
    else
      graphics.circles!.push({
        center: c.start,
        radius: Math.max(c.radius, 0.08),
        fill: color,
        layer,
        step,
      })
  }
  for (const t of problem.terminals)
    graphics.points!.push({
      ...t.point,
      color: "#15803d",
      label: t.id,
      layer: getGraphicsLayerFromLayerNames(
        t.layers.map((z) => (z === 0 ? "top" : "bottom")),
        2,
      ),
      step,
    })
  for (const trace of traces) {
    for (let i = 0; i < trace.route.length; i++) {
      const a = trace.route[i]!,
        b = trace.route[i + 1]
      if (a.route_type === "via")
        graphics.circles!.push({
          center: a,
          radius: (a.via_diameter ?? problem.viaDiameter) / 2,
          fill: "#2563eb",
          layer: getGraphicsLayerFromLayerNames([a.from_layer, a.to_layer], 2),
          step,
        })
      else if (
        a.route_type === "wire" &&
        b?.route_type === "wire" &&
        a.layer === b.layer
      )
        graphics.lines!.push({
          points: [a, b],
          strokeWidth: a.width,
          strokeColor: "#15803d",
          layer: getGraphicsLayerFromLayerNames([a.layer], 2),
          strokeDash: a.layer === "bottom" ? "0.15 0.1" : undefined,
          step,
        })
    }
  }
  graphics.texts!.push({
    x: problem.bounds.minX,
    y: problem.bounds.maxY + 0.5,
    text: label,
    anchorSide: "bottom_left",
    fontSize: 0.35,
    step,
  })
  return graphics
}
