import type { GraphicsObject } from "graphics-debug"
import { renderRvboyRoutingView } from "./renderRvboyRoutingView"
import type { SimpleRouteJson } from "lib/types"

/** Draw the affected bottom-layer reservation from the complete solver output. */
export function getRvboyEscapeViaSpanView(output: SimpleRouteJson): string {
  const via = output.obstacles.find((obstacle) =>
    obstacle.obstacleId?.includes(":pcb_port_583:inner1:"),
  )
  if (!via) throw new Error("Missing RVboy ground escape via for pcb_port_583")
  const reserved = via.layers.includes("bottom")
  const color = reserved ? "#15803d" : "#dc2626"
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    rects: [
      ...output.obstacles
        .filter(
          (obstacle) =>
            !obstacle.isCopperPour &&
            obstacle.layers.includes("bottom") &&
            Math.abs(obstacle.center.x - via.center.x) < 1 &&
            Math.abs(obstacle.center.y - via.center.y) < 0.8,
        )
        .map((obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: obstacle === via ? "#bbf7d0" : "#dbeafe",
          stroke: obstacle === via ? color : "#2563eb",
        })),
    ],
    circles: [
      {
        center: via.center,
        radius: via.width / 2,
        fill: color,
        stroke: color,
        label: "Physical through-hole via pad: 0.45 mm",
      },
      {
        center: via.center,
        radius: 0.1,
        fill: "white",
        stroke: "#475569",
        label: "Drill: 0.20 mm",
      },
    ],
  }
  return renderRvboyRoutingView(
    graphics,
    {
      minX: via.center.x - 0.8,
      maxX: via.center.x + 0.8,
      minY: via.center.y - 0.48,
      maxY: via.center.y + 0.48,
    },
    reserved
      ? "Bottom-layer via reservation is present"
      : "Bottom-layer via reservation is missing",
    "Exact RVboy input; view: 1.6 x 0.96 mm around (-30.49, 18.305). Shading: routing obstacles.",
  )
}
