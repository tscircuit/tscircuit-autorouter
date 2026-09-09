import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"

export const visualizeHighDensityRoutes = (
  routes: HighDensityRoute[],
  colorMap: Record<string, string>,
  title: string,
): GraphicsObject => {
  const lines: NonNullable<GraphicsObject["lines"]> = []
  const circles: NonNullable<GraphicsObject["circles"]> = []
  for (const route of routes) {
    const color = colorMap[route.connectionName] ?? "#0ea5e9"
    for (let index = 0; index < route.route.length - 1; index++) {
      const a = route.route[index]!
      const b = route.route[index + 1]!
      if (a.z !== b.z) continue
      lines.push({
        points: [a, b],
        strokeColor: color,
        strokeWidth: a.traceThickness ?? route.traceThickness,
        layer: `z${a.z}`,
        strokeDash: a.z === 0 ? undefined : [0.1, 0.3],
      })
    }
    for (const via of route.vias) {
      circles.push({
        center: via,
        radius: route.viaDiameter / 2,
        stroke: color,
        fill: "rgba(14,165,233,0.12)",
      })
    }
  }
  return { title: title, lines, circles }
}
