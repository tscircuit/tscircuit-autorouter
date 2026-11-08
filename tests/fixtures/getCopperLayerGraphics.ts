import type { AnyCircuitElement } from "circuit-json"
import type { GraphicsObject } from "graphics-debug"
import { compileTraceClearanceObstacle } from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"

/** Render physical copper, without topology markers or obstacle bounding boxes. */
export const getCopperLayerGraphics = (
  circuitJson: AnyCircuitElement[],
  layer: string,
): GraphicsObject => {
  const graphics: Required<
    Pick<GraphicsObject, "circles" | "lines" | "polygons">
  > = {
    circles: [],
    lines: [],
    polygons: [],
  }
  const capsule = (
    start: { x: number; y: number },
    end: { x: number; y: number },
    radius: number,
  ): void => {
    graphics.lines.push({
      points: [start, end],
      strokeColor: "red",
      strokeWidth: radius * 2,
    })
    graphics.circles.push(
      ...[start, end].map((center) => ({
        center,
        radius,
        fill: "red",
        stroke: "none",
      })),
    )
  }
  for (const element of circuitJson) {
    if (element.type === "pcb_trace") {
      for (let i = 1; i < element.route.length; i++) {
        const a = element.route[i - 1],
          b = element.route[i]
        if (
          a.route_type === "wire" &&
          b.route_type === "wire" &&
          a.layer === layer &&
          b.layer === layer
        ) {
          capsule({ x: a.x, y: a.y }, { x: b.x, y: b.y }, a.width / 2)
        }
      }
    } else if (
      element.type === "pcb_via" ||
      element.type === "pcb_smtpad" ||
      element.type === "pcb_plated_hole"
    ) {
      const compiled = compileTraceClearanceObstacle(element, 0)
      if (!compiled.layers.includes(layer)) continue
      const shape = compiled.shape
      if (shape.kind === "circle")
        graphics.circles.push({
          center: shape.center,
          radius: shape.radius,
          fill: "red",
          stroke: "none",
        })
      else if (shape.kind === "capsule")
        capsule(shape.start, shape.end, shape.radius)
      else {
        graphics.polygons.push({
          points: shape.points,
          fill: "red",
          stroke: "none",
        })
        if (shape.radius)
          for (let i = 0; i < shape.points.length; i++) {
            capsule(
              shape.points[i],
              shape.points[(i + 1) % shape.points.length],
              shape.radius,
            )
          }
      }
    }
  }
  return graphics
}
