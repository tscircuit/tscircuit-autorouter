import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"

/** Board-world points in mm (+X right, +Y up). Include a centerline section
 * with clearance for every proven blocker.
 * A barrel can conflict with a regional detour while its center lies outside
 * the original mesh cell. It must be inside the next region to be movable. */
export function includePromotedRouteCenters(
  node: NodeWithPortPoints,
  routes: readonly HighDensityRoute[],
  promotedNames: ReadonlySet<string>,
  margin: number,
): NodeWithPortPoints {
  if (promotedNames.size === 0) return node
  let minX = node.center.x - node.width / 2
  let maxX = node.center.x + node.width / 2
  let minY = node.center.y - node.height / 2
  let maxY = node.center.y + node.height / 2
  for (const route of routes) {
    if (!promotedNames.has(route.connectionName)) continue
    let nearest: { x: number; y: number } | undefined
    let distance = Infinity
    for (let index = 1; index < route.route.length; index++) {
      const start = route.route[index - 1]!, end = route.route[index]!
      const dx = end.x - start.x, dy = end.y - start.y
      const squaredLength = dx * dx + dy * dy
      const t = squaredLength === 0 ? 0 : Math.max(0, Math.min(1,
        ((node.center.x - start.x) * dx + (node.center.y - start.y) * dy) / squaredLength,
      ))
      const point = { x: start.x + t * dx, y: start.y + t * dy }
      const candidateDistance = Math.hypot(point.x - node.center.x, point.y - node.center.y)
      if (candidateDistance < distance) { nearest = point; distance = candidateDistance }
    }
    if (!nearest) throw new Error(`Promoted route "${route.connectionName}" has no centerline`)
    minX = Math.min(minX, nearest.x - margin)
    maxX = Math.max(maxX, nearest.x + margin)
    minY = Math.min(minY, nearest.y - margin)
    maxY = Math.max(maxY, nearest.y + margin)
  }
  if (minX === node.center.x - node.width / 2 &&
    maxX === node.center.x + node.width / 2 &&
    minY === node.center.y - node.height / 2 &&
    maxY === node.center.y + node.height / 2) return node
  return { ...node, center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width: maxX - minX, height: maxY - minY }
}
