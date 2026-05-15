import { getBoundingBox } from "@tscircuit/math-utils"
import type { Obstacle, SimpleRouteJson } from "lib/types"

export function getBoundsForObstacles(
  obstacles: Obstacle[],
): SimpleRouteJson["bounds"] {
  if (obstacles.length === 0) {
    return {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
    }
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const obstacle of obstacles) {
    const bounds = getBoundingBox(obstacle)
    minX = Math.min(minX, bounds.minX)
    maxX = Math.max(maxX, bounds.maxX)
    minY = Math.min(minY, bounds.minY)
    maxY = Math.max(maxY, bounds.maxY)
  }

  return { minX, maxX, minY, maxY }
}
