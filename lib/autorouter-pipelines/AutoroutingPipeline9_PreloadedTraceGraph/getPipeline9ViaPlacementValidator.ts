import type { Obstacle } from "lib/types/srj-types"
import type { ViaPlacementValidator } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import {
  getPipeline9PhysicalObstacleOwner,
  getPipeline9PhysicalRouteOwner,
  type Pipeline9PhysicalOwnership,
} from "./getPipeline9PhysicalOwnership"
import { getPipeline9PhysicalBoardObstaclesInBounds } from "./getPipeline9PhysicalBoardObstaclesInBounds"

export type Pipeline9ViaPlacementContext = {
  boardObstacles: Obstacle[]
  physicalOwnership: Pipeline9PhysicalOwnership
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  clearance: number
}

/** Guide via generation with original pad ownership and manufactured layer spans. */
export const getPipeline9ViaPlacementValidator = (
  context: Pipeline9ViaPlacementContext,
): ViaPlacementValidator => {
  if (!Number.isSafeInteger(context.layerCount) || context.layerCount < 2 ||
    !Number.isFinite(context.clearance) || context.clearance < 0) {
    throw new Error("Invalid original via-placement constraints")
  }
  const obstacleOwners = new WeakMap<Obstacle, string | undefined>()
  const ownerByConnection = new Map<string, string | undefined>()
  return (placement, connectionName): boolean => {
    if (![placement.x, placement.y, placement.viaDiameter].every(Number.isFinite) ||
      placement.viaDiameter <= 0 || !Number.isSafeInteger(placement.zStart) ||
      !Number.isSafeInteger(placement.zEnd) || placement.zStart < 0 || placement.zEnd < 0 ||
      placement.zStart >= context.layerCount || placement.zEnd >= context.layerCount) {
      throw new Error("Invalid manufactured via candidate")
    }
    if (!ownerByConnection.has(connectionName)) {
      ownerByConnection.set(connectionName,
        getPipeline9PhysicalRouteOwner(context.physicalOwnership, { connectionName }))
    }
    const owner = ownerByConnection.get(connectionName)
    const minZ = context.allowBlindAndBuriedVias ? Math.min(placement.zStart, placement.zEnd) : 0
    const maxZ = context.allowBlindAndBuriedVias ? Math.max(placement.zStart, placement.zEnd) : context.layerCount - 1
    const radius = placement.viaDiameter / 2
    const padding = radius + context.clearance
    const nearby = getPipeline9PhysicalBoardObstaclesInBounds(context.boardObstacles, {
      minX: placement.x - padding, minY: placement.y - padding,
      maxX: placement.x + padding, maxY: placement.y + padding,
    })
    for (const obstacle of nearby) {
      if (!obstacleOwners.has(obstacle)) {
        obstacleOwners.set(obstacle, getPipeline9PhysicalObstacleOwner(context.physicalOwnership, obstacle))
      }
      if (!obstacle.isNonPlatedHole && owner !== undefined && owner === obstacleOwners.get(obstacle)) continue
      const layers = obstacle.__zLayers ?? obstacle.zLayers ??
        obstacle.layers.map((layer) => mapLayerNameToZ(layer, context.layerCount))
      if (!obstacle.isNonPlatedHole && !layers.some((z) => z >= minZ && z <= maxZ)) continue
      const dx = placement.x - obstacle.center.x
      const dy = placement.y - obstacle.center.y
      let distance: number
      if (obstacle.shape === "circle") {
        distance = Math.hypot(dx, dy) - obstacle.width / 2
      } else {
        const radians = (-(obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
        const localX = dx * Math.cos(radians) - dy * Math.sin(radians)
        const localY = dx * Math.sin(radians) + dy * Math.cos(radians)
        const outsideX = Math.abs(localX) - obstacle.width / 2
        const outsideY = Math.abs(localY) - obstacle.height / 2
        distance = Math.hypot(Math.max(outsideX, 0), Math.max(outsideY, 0)) +
          Math.min(Math.max(outsideX, outsideY), 0)
      }
      if (distance < padding) return false
    }
    return true
  }
}
