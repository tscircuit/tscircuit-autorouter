import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

/** Keep validated copper inside the bounds used by later node-local cleanup. */
export const getNodeWithCopperBounds = ({
  node,
  routes,
  margin,
}: {
  node: NodeWithPortPoints
  routes: readonly HighDensityRoute[]
  margin: number
}): NodeWithPortPoints => {
  let halfWidth = node.width / 2
  let halfHeight = node.height / 2
  for (const route of routes) {
    const radius = Math.max(route.traceThickness, route.viaDiameter) / 2 + margin
    for (const point of [...route.route, ...route.vias]) {
      halfWidth = Math.max(halfWidth, Math.abs(point.x - node.center.x) + radius)
      halfHeight = Math.max(halfHeight, Math.abs(point.y - node.center.y) + radius)
    }
  }
  return { ...node, width: halfWidth * 2, height: halfHeight * 2 }
}
