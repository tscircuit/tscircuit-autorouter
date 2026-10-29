import type { Obstacle } from "lib/types/srj-types"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { ViaPlacementValidator } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import {
  getPipeline9PhysicalObstacleOwner,
  getPipeline9PhysicalRouteOwner,
  type Pipeline9PhysicalOwnership,
} from "./getPipeline9PhysicalOwnership"
import { getPipeline9PadPointDistance } from "./getPipeline9PadPointDistance"
import { getPipeline9PhysicalBoardObstaclesInBounds } from "./getPipeline9PhysicalBoardObstaclesInBounds"
import { getPipeline9ViaBoardPlacementValidator } from "./getPipeline9ViaBoardPlacementValidator"

export type Pipeline9ViaPlacementContext = {
  boardGeometry: HighDensityBoardGeometry
  boardObstacles: Obstacle[]
  physicalOwnership: Pipeline9PhysicalOwnership
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  clearance: number
}

/** Guide via generation with the original board, pad owners, and drilled span. */
export const getPipeline9ViaPlacementValidator = (
  context: Pipeline9ViaPlacementContext,
): ViaPlacementValidator => {
  if (!Number.isSafeInteger(context.layerCount) || context.layerCount < 2 ||
    !Number.isFinite(context.clearance) || context.clearance < 0) {
    throw new Error("Invalid original via-placement constraints")
  }
  const isInsideBoard = getPipeline9ViaBoardPlacementValidator(context.boardGeometry)
  const obstacleOwners = new WeakMap<Obstacle, string | undefined>()
  const ownerByConnection = new Map<string, string | undefined>()
  return (placement, connectionName): boolean => {
    if (![placement.x, placement.y, placement.viaDiameter].every(Number.isFinite) ||
      placement.viaDiameter <= 0 || !Number.isSafeInteger(placement.zStart) ||
      !Number.isSafeInteger(placement.zEnd) || placement.zStart < 0 || placement.zEnd < 0 ||
      placement.zStart >= context.layerCount || placement.zEnd >= context.layerCount) {
      throw new Error("Invalid manufactured via candidate")
    }
    if (!isInsideBoard(placement)) return false
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
      const distance = getPipeline9PadPointDistance(placement, obstacle, "outer")
      if (distance < padding) return false
    }
    return true
  }
}
