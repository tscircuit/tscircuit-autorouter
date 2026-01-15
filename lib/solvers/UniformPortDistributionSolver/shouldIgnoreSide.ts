import { Obstacle } from "lib/types"
import { Bounds, Side } from "./types"

interface ShouldIgnoreSideParams {
  nodeId: string
  side: Side
  nodeBounds: Map<string, Bounds>
  obstacles: Obstacle[]
}

export const shouldIgnoreSide = ({
  nodeId,
  side,
  nodeBounds,
  obstacles,
}: ShouldIgnoreSideParams): boolean => {
  const bounds = nodeBounds.get(nodeId)!

  for (const obstacle of obstacles) {
    const margin = 0.001
    const obsMinX = obstacle.center.x - obstacle.width / 2
    const obsMaxX = obstacle.center.x + obstacle.width / 2
    const obsMinY = obstacle.center.y - obstacle.height / 2
    const obsMaxY = obstacle.center.y + obstacle.height / 2

    switch (side) {
      case "top":
        if (
          Math.abs(bounds.maxY - obsMinY) < margin ||
          Math.abs(bounds.maxY - obsMaxY) < margin
        ) {
          const overlapMinX = Math.max(bounds.minX, obsMinX)
          const overlapMaxX = Math.min(bounds.maxX, obsMaxX)
          if (overlapMaxX - overlapMinX > margin) return true
        }
        break
      case "bottom":
        if (
          Math.abs(bounds.minY - obsMinY) < margin ||
          Math.abs(bounds.minY - obsMaxY) < margin
        ) {
          const overlapMinX = Math.max(bounds.minX, obsMinX)
          const overlapMaxX = Math.min(bounds.maxX, obsMaxX)
          if (overlapMaxX - overlapMinX > margin) return true
        }
        break
      case "left":
        if (
          Math.abs(bounds.minX - obsMinX) < margin ||
          Math.abs(bounds.minX - obsMaxX) < margin
        ) {
          const overlapMinY = Math.max(bounds.minY, obsMinY)
          const overlapMaxY = Math.min(bounds.maxY, obsMaxY)
          if (overlapMaxY - overlapMinY > margin) return true
        }
        break
      case "right":
        if (
          Math.abs(bounds.maxX - obsMinX) < margin ||
          Math.abs(bounds.maxX - obsMaxX) < margin
        ) {
          const overlapMinY = Math.max(bounds.minY, obsMinY)
          const overlapMaxY = Math.min(bounds.maxY, obsMaxY)
          if (overlapMaxY - overlapMinY > margin) return true
        }
        break
    }
  }
  return false
}
