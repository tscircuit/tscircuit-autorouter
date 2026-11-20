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
  const originalHalfWidth = node.width / 2
  const originalHalfHeight = node.height / 2
  let halfWidth = originalHalfWidth
  let halfHeight = originalHalfHeight
  let hasDetour = false
  for (const route of routes) {
    const radius = Math.max(route.traceThickness, route.viaDiameter) / 2 + margin
    for (const point of [...route.route, ...route.vias]) {
      const offsetX = Math.abs(point.x - node.center.x)
      const offsetY = Math.abs(point.y - node.center.y)
      if (
        offsetX > originalHalfWidth + 1e-6 ||
        offsetY > originalHalfHeight + 1e-6
      ) {
        hasDetour = true
      }
      halfWidth = Math.max(halfWidth, offsetX + radius)
      halfHeight = Math.max(halfHeight, offsetY + radius)
    }
  }
  if (!hasDetour) return node
  return { ...node, width: halfWidth * 2, height: halfHeight * 2 }
}
