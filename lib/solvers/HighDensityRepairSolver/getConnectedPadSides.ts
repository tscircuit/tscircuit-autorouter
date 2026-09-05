import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { isObstacleConnectedToRoute } from "../TraceWidthSolver/isObstacleConnectedToRoute"

type BoundarySide = "left" | "right" | "top" | "bottom"

export const getConnectedPadSides = (
  node: NodeWithPortPoints,
  route: HighDensityRoute,
  obstacles: Array<Obstacle & { __zLayers: number[] }>,
  connMap: ConnectivityMap,
): BoundarySide[] => {
  // Repair01 rounds coordinates to 0.001 mm before handing them to repair02.
  const tolerance = 0.001
  const sides = new Set<BoundarySide>()
  for (const point of [route.route[0], route.route.at(-1)]) {
    if (!point) continue
    const entersConnectedPad = obstacles.some(
      (obstacle) =>
        obstacle.__zLayers.includes(point.z) &&
        Math.abs(point.x - obstacle.center.x) <=
          obstacle.width / 2 + tolerance &&
        Math.abs(point.y - obstacle.center.y) <=
          obstacle.height / 2 + tolerance &&
        isObstacleConnectedToRoute(obstacle, route, connMap),
    )
    if (!entersConnectedPad) continue
    if (Math.abs(point.x - (node.center.x - node.width / 2)) <= tolerance) {
      sides.add("left")
    }
    if (Math.abs(point.x - (node.center.x + node.width / 2)) <= tolerance) {
      sides.add("right")
    }
    if (Math.abs(point.y - (node.center.y - node.height / 2)) <= tolerance) {
      sides.add("bottom")
    }
    if (Math.abs(point.y - (node.center.y + node.height / 2)) <= tolerance) {
      sides.add("top")
    }
  }
  return [...sides]
}
