import { Obstacle } from "lib/types"
import { SharedEdge } from "./types"

const EPSILON = 1e-6

/**
 * Rejects shared edges that are effectively blocked by obstacle boundaries,
 * preventing redistribution onto segments that are not routing-safe.
 */
export const shouldIgnoreSharedEdge = ({
  sharedEdge,
  obstacles,
}: {
  sharedEdge: SharedEdge
  obstacles: Obstacle[]
}): boolean => {
  for (const obstacle of obstacles) {
    const obsMinX = obstacle.center.x - obstacle.width / 2
    const obsMaxX = obstacle.center.x + obstacle.width / 2
    const obsMinY = obstacle.center.y - obstacle.height / 2
    const obsMaxY = obstacle.center.y + obstacle.height / 2

    if (sharedEdge.orientation === "vertical") {
      if (
        Math.abs(sharedEdge.x1 - obsMinX) < EPSILON ||
        Math.abs(sharedEdge.x1 - obsMaxX) < EPSILON
      ) {
        const overlapMinY = Math.max(sharedEdge.y1, obsMinY)
        const overlapMaxY = Math.min(sharedEdge.y2, obsMaxY)
        if (overlapMaxY - overlapMinY > EPSILON) return true
      }
      continue
    }

    if (
      Math.abs(sharedEdge.y1 - obsMinY) < EPSILON ||
      Math.abs(sharedEdge.y1 - obsMaxY) < EPSILON
    ) {
      const overlapMinX = Math.max(sharedEdge.x1, obsMinX)
      const overlapMaxX = Math.min(sharedEdge.x2, obsMaxX)
      if (overlapMaxX - overlapMinX > EPSILON) return true
    }
  }

  return false
}
