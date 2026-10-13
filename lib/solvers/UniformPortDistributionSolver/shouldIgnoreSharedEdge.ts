import type { Obstacle } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { SharedEdge } from "./types"

export const SHARED_EDGE_EPSILON = 1e-6

/**
 * Rejects shared edges that are effectively blocked by obstacle boundaries,
 * preventing redistribution onto segments that are not routing-safe.
 */
export const shouldIgnoreSharedEdge = ({
  sharedEdge,
  obstacles,
  z,
  layerCount,
}: {
  sharedEdge: SharedEdge
  obstacles: Obstacle[]
  z?: number
  layerCount?: number
}): boolean => {
  for (const obstacle of obstacles) {
    const obstacleZLayers =
      obstacle.zLayers ??
      (layerCount === undefined
        ? undefined
        : obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount)))
    if (z !== undefined && obstacleZLayers && !obstacleZLayers.includes(z)) {
      continue
    }
    const obsMinX = obstacle.center.x - obstacle.width / 2
    const obsMaxX = obstacle.center.x + obstacle.width / 2
    const obsMinY = obstacle.center.y - obstacle.height / 2
    const obsMaxY = obstacle.center.y + obstacle.height / 2

    if (sharedEdge.orientation === "vertical") {
      if (
        Math.abs(sharedEdge.x1 - obsMinX) < SHARED_EDGE_EPSILON ||
        Math.abs(sharedEdge.x1 - obsMaxX) < SHARED_EDGE_EPSILON
      ) {
        const overlapMinY = Math.max(sharedEdge.y1, obsMinY)
        const overlapMaxY = Math.min(sharedEdge.y2, obsMaxY)
        if (overlapMaxY - overlapMinY > SHARED_EDGE_EPSILON) return true
      }
      continue
    }

    if (
      Math.abs(sharedEdge.y1 - obsMinY) < SHARED_EDGE_EPSILON ||
      Math.abs(sharedEdge.y1 - obsMaxY) < SHARED_EDGE_EPSILON
    ) {
      const overlapMinX = Math.max(sharedEdge.x1, obsMinX)
      const overlapMaxX = Math.min(sharedEdge.x2, obsMaxX)
      if (overlapMaxX - overlapMinX > SHARED_EDGE_EPSILON) return true
    }
  }

  return false
}
