import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

/** Find layers covered by the union of axis-aligned, foreign pour rectangles. */
export const getFullyCoveredNodeLayers = (
  node: NodeWithPortPoints,
  foreignPours: Obstacle[],
  layerCount: number,
): Set<number> => {
  const minX = node.center.x - node.width / 2
  const maxX = node.center.x + node.width / 2
  const minY = node.center.y - node.height / 2
  const maxY = node.center.y + node.height / 2
  const rectangles = foreignPours
    .filter(
      (obstacle) => obstacle.type === "rect" && !obstacle.ccwRotationDegrees,
    )
    .map((obstacle) => ({
      minX: Math.max(minX, obstacle.center.x - obstacle.width / 2),
      maxX: Math.min(maxX, obstacle.center.x + obstacle.width / 2),
      minY: Math.max(minY, obstacle.center.y - obstacle.height / 2),
      maxY: Math.min(maxY, obstacle.center.y + obstacle.height / 2),
      zLayers:
        obstacle.__zLayers ??
        obstacle.zLayers ??
        obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount)),
    }))
    .filter((rect) => rect.minX < rect.maxX && rect.minY < rect.maxY)
  const blocked = new Set<number>()
  for (const z of node.availableZ ??
    Array.from({ length: layerCount }, (_, z) => z)) {
    const rects = rectangles.filter((rect) => rect.zLayers.includes(z))
    const cuts = [
      ...new Set([
        minX,
        maxX,
        ...rects.flatMap((rect) => [rect.minX, rect.maxX]),
      ]),
    ].sort((a, b) => a - b)
    let covered = rects.length > 0
    for (let i = 1; covered && i < cuts.length; i++) {
      const x = (cuts[i - 1]! + cuts[i]!) / 2
      const intervals = rects
        .filter((rect) => rect.minX <= x && rect.maxX >= x)
        .sort((a, b) => a.minY - b.minY)
      let end = minY
      for (const interval of intervals) {
        if (interval.minY > end) break
        end = Math.max(end, interval.maxY)
      }
      covered = end >= maxY
    }
    if (covered) blocked.add(z)
  }
  return blocked
}
