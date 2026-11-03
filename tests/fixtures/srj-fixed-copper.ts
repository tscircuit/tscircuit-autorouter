import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, Obstacle } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

export const fixedCopperSrj: SimpleRouteJson = {
  layerCount: 4,
  minTraceWidth: 0.4,
  bounds: { minX: -1, maxX: 5, minY: -4, maxY: 4 },
  obstacles: [],
  connections: [
    {
      name: "FIXED",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 4, y: 2, layer: "bottom" },
      ],
    },
  ],
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "fixed_trace",
      connection_name: "FIXED",
      route: [
        { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.4 },
        { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.4 },
        {
          route_type: "via",
          x: 2,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.8,
        },
        { route_type: "wire", x: 2, y: 0, layer: "bottom", width: 0.6 },
        { route_type: "wire", x: 4, y: 2, layer: "bottom", width: 0.6 },
      ],
    },
  ],
}

/** Board-world points in mm, +X right/+Y up, right-handed, CCW rotation. */
export function obstacleContainsPoint(
  obstacle: Obstacle,
  point: { x: number; y: number },
): boolean {
  const radians = -((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const dx = point.x - obstacle.center.x
  const dy = point.y - obstacle.center.y
  const local = {
    x: dx * Math.cos(radians) - dy * Math.sin(radians),
    y: dx * Math.sin(radians) + dy * Math.cos(radians),
  }
  return obstacle.shape === "circle"
    ? Math.hypot(local.x, local.y) <= obstacle.width / 2 + 1e-9
    : Math.abs(local.x) <= obstacle.width / 2 + 1e-9 &&
        Math.abs(local.y) <= obstacle.height / 2 + 1e-9
}

export function fixedCopperObstacleGraphics(
  obstacles: Obstacle[],
): GraphicsObject {
  const source = convertSrjToGraphicsObject({
    ...fixedCopperSrj,
    connections: [],
  })
  return {
    ...source,
    rects: obstacles
      .filter((obstacle) => obstacle.shape !== "circle")
      .map((obstacle) => ({
        center: { x: obstacle.center.x, y: obstacle.center.y - 4 },
        width: obstacle.width,
        height: obstacle.height,
        ccwRotationDegrees: obstacle.ccwRotationDegrees,
        fill: "rgba(255,0,0,0.7)",
      })),
    circles: [
      ...source.circles,
      ...obstacles
        .filter((obstacle) => obstacle.shape === "circle")
        .map((obstacle) => ({
          center: { x: obstacle.center.x, y: obstacle.center.y - 4 },
          radius: obstacle.width / 2,
          fill: "rgba(255,0,0,0.7)",
        })),
    ],
    texts: [
      { x: 2, y: 3, text: "Supplied completed copper", fontSize: 0.3 },
      {
        x: 2,
        y: -5,
        text: "SRJ obstacles: exact round ends expected",
        fontSize: 0.3,
      },
    ],
  }
}
