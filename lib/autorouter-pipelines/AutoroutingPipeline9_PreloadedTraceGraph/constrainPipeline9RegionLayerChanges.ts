import type { HyperGraphHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { getPipeline9PhysicalBoardObstaclesInBounds } from "./getPipeline9PhysicalBoardObstaclesInBounds"
import {
  getPipeline9PhysicalObstacleOwner,
  type Pipeline9PhysicalOwnership,
} from "./getPipeline9PhysicalOwnership"

/** Keep planar travel through surface-pad shadows while moving foreign through vias elsewhere. */
export const constrainPipeline9RegionLayerChanges = ({
  graph,
  originalSrj,
  physicalOwnership,
  routingNetIds,
}: {
  graph: HyperGraphHg
  originalSrj: SimpleRouteJson
  physicalOwnership: Pipeline9PhysicalOwnership
  routingNetIds: readonly string[]
}): number => {
  if (originalSrj.allowBlindAndBuriedVias) return 0
  const knownRoutingNets = new Set(routingNetIds)
  let constrainedCount = 0
  for (const region of graph.regions) {
    if (region.d.availableZ.length < 2) continue
    const halfWidth = region.d.width / 2
    const halfHeight = region.d.height / 2
    const bounds = {
      minX: region.d.center.x - halfWidth, maxX: region.d.center.x + halfWidth,
      minY: region.d.center.y - halfHeight, maxY: region.d.center.y + halfHeight,
    }
    const corners = [
      { x: bounds.minX, y: bounds.minY }, { x: bounds.minX, y: bounds.maxY },
      { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY },
    ]
    let allowedNets: Set<string> | undefined
    for (const obstacle of getPipeline9PhysicalBoardObstaclesInBounds(originalSrj.obstacles, bounds)) {
      if (obstacle.layers.length === 0 && !(obstacle.zLayers?.length) && !(obstacle.__zLayers?.length)) continue
      const radians = (-(obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
      const cos = Math.cos(radians), sin = Math.sin(radians)
      const covered = corners.every((corner) => {
        const dx = corner.x - obstacle.center.x, dy = corner.y - obstacle.center.y
        if (obstacle.shape === "circle") return Math.hypot(dx, dy) <= obstacle.width / 2 + 1e-9
        return Math.abs(dx * cos - dy * sin) <= obstacle.width / 2 + 1e-9 &&
          Math.abs(dx * sin + dy * cos) <= obstacle.height / 2 + 1e-9
      })
      if (!covered) continue
      const owner = obstacle.isNonPlatedHole ? undefined :
        getPipeline9PhysicalObstacleOwner(physicalOwnership, obstacle)
      const obstacleAllowed = new Set(Object.entries(physicalOwnership.routingNetOwners)
        .filter(([netId, netOwner]) => owner !== undefined && netOwner === owner && knownRoutingNets.has(netId))
        .map(([netId]) => netId))
      allowedNets = allowedNets === undefined ? obstacleAllowed :
        new Set([...allowedNets].filter((netId) => obstacleAllowed.has(netId)))
    }
    if (allowedNets === undefined) continue
    region.d = { ...region.d, layerChangeAllowedNetIds: [...allowedNets].sort() }
    constrainedCount++
  }
  return constrainedCount
}
