import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "../../types/high-density-types"
import type { Obstacle } from "../../types"
import { getUniqueValidZLayers, mapLayerNameToZ } from "../../utils/mapLayerNameToZ"
import { pointInsideObstacleCopper } from "../../utils/pointInsideObstacleCopper"
import { routePointTouchesObstacleCopper } from "../../utils/routePointTouchesObstacleCopper"

export type PhysicalCopperTransitionConfig = {
  obstacles: readonly Obstacle[]
  connMap: ConnectivityMap
  layerCount: number
}

/** Explicit physical spans take precedence over the legacy layer-name approximation. */
export function getPhysicalCopperObstacleZLayers(obstacle: Obstacle, layerCount: number): number[] {
  return getUniqueValidZLayers(obstacle.__zLayers ?? obstacle.zLayers ??
    obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount)), layerCount)
}

/** Re-proves barrel transitions and restores colocated vias after later repairs move copper. */
export function markPhysicalCopperTransitions(
  routes: readonly HighDensityRoute[], config: PhysicalCopperTransitionConfig,
): HighDensityRoute[] {
  const spans = config.obstacles.map((obstacle) => ({ obstacle,
    zLayers: getPhysicalCopperObstacleZLayers(obstacle, config.layerCount) }))
    .filter(({ zLayers }) => zLayers.length > 1)
  const isConnected = (route: HighDensityRoute, obstacle: Obstacle): boolean => obstacle.connectedTo.some((id) =>
    id === route.connectionName || id === route.rootConnectionName ||
    config.connMap.areIdsConnected(route.connectionName, id) ||
    (route.rootConnectionName !== undefined && config.connMap.areIdsConnected(route.rootConnectionName, id)))
  return routes.map((route) => {
    const obstacles = spans.filter(({ obstacle }) => isConnected(route, obstacle))
    const vias = route.vias.filter((via) => !obstacles.some(({ obstacle }) => pointInsideObstacleCopper(via, obstacle)))
      .map((via) => ({ ...via }))
    const points = route.route.map((point, index, input) => {
      const next = input[index + 1]
      const matching = next && point.z !== next.z && obstacles.find(({ obstacle, zLayers }) =>
        zLayers.includes(point.z) && zLayers.includes(next.z) &&
        routePointTouchesObstacleCopper(route, index, obstacle) &&
        routePointTouchesObstacleCopper(route, index + 1, obstacle))
      const finalized = { ...point }
      delete finalized.toNextSegmentType
      delete finalized.toNextSegmentCircuitJsonMetadata
      if (matching) {
        finalized.toNextSegmentType = "through_obstacle"
        if (matching.obstacle.circuitJsonMetadata) {
          finalized.toNextSegmentCircuitJsonMetadata = matching.obstacle.circuitJsonMetadata
        }
      } else if (next && point.z !== next.z) {
        if (Math.hypot(point.x - next.x, point.y - next.y) > 1e-6) {
          throw new Error(`Physical simplification found a noncolocated layer change for ${route.connectionName}`)
        }
        if (!vias.some((via) => Math.hypot(via.x - point.x, via.y - point.y) <= 1e-6)) {
          vias.push({ x: point.x, y: point.y })
        }
      }
      return finalized
    })
    return { ...route, route: points, vias }
  })
}
