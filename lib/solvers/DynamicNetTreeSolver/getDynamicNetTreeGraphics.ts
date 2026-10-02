import type { GraphicsObject } from "graphics-debug"
import type { SimplifiedPcbTrace } from "../../types"
import { getGraphicsLayerFromLayerNames } from "../../utils/getGraphicsObjectLayer"
import { mapZToLayerName } from "../../utils/mapZToLayerName"
import { copperRectangleCorners } from "./dynamicNetTreeGeometry"
import { postRoutingViaLayers } from "./postRoutingLayers"
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
      c.layers.map((z) => mapZToLayerName(z, problem.layerCount)),
      problem.layerCount,
    )
    const color = c.owner === problem.net ? "#15803d" : "#94a3b8"
    if (c.rectangle) {
      graphics.rects!.push({
        center: c.start,
        width: c.rectangle.width,
        height: c.rectangle.height,
        ccwRotationDegrees: (c.rectangle.rotation * 180) / Math.PI,
        fill: color,
        layer,
        step,
      })
      if (c.radius > 0) {
        const corners = copperRectangleCorners(c)
        for (const [i, point] of corners.entries())
          graphics.lines!.push({
            points: [point, corners[(i + 1) % corners.length]!],
            strokeWidth: c.radius * 2,
            strokeColor: color,
            layer,
            step,
          })
      }
    } else if (
      c.kind === "wire" ||
      Math.hypot(c.start.x - c.end.x, c.start.y - c.end.y) > 1e-8
    )
      graphics.lines!.push({
        points: [c.start, c.end],
        strokeWidth: c.radius * 2,
        strokeColor: color,
        layer,
        step,
        strokeDash:
          c.kind === "wire" && c.layers[0] !== 0 ? "0.15 0.1" : undefined,
      })
    else
      graphics.circles!.push({
        center: c.start,
        radius: Math.max(c.radius, 0.08),
        fill: c.kind === "hole" ? "white" : color,
        stroke: c.kind === "hole" ? color : undefined,
        layer,
        step,
      })
    if (c.drill && c.kind !== "hole")
      graphics.circles!.push({
        center: c.drill.start,
        radius: c.drill.diameter / 2,
        fill: "white",
        stroke: color,
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
        t.layers.map((z) => mapZToLayerName(z, problem.layerCount)),
        problem.layerCount,
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
          layer: getGraphicsLayerFromLayerNames(
            postRoutingViaLayers(problem, a).map((z) =>
              mapZToLayerName(z, problem.layerCount),
            ),
            problem.layerCount,
          ),
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
          layer: getGraphicsLayerFromLayerNames([a.layer], problem.layerCount),
          strokeDash: a.layer !== "top" ? "0.15 0.1" : undefined,
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
