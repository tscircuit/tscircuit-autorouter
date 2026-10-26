import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

type ViaObstacleCollisionParams = {
  routes: HighDensityIntraNodeRoute[]
  obstacles: Obstacle[]
  connMap?: ConnectivityMap
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  viaDiameter?: number
  viaToPadClearance: number
  center: { x: number; y: number }
  coordinateScale: number
}

/** Checks drilled via copper in board coordinates, including excluded wire layers. */
export const hasViaObstacleCollision = (
  params: ViaObstacleCollisionParams,
): boolean => {
  if (!Number.isFinite(params.coordinateScale) || params.coordinateScale <= 0) {
    throw new Error("Invalid via-candidate coordinate scale")
  }
  for (const route of params.routes) {
    const { viaSpans } = getPipeline9RouteCopperGeometry(route, params)
    for (const via of viaSpans) {
      // Traversing an existing plated obstacle does not drill a new via.
      const existingCopper = route.route.some((point, index) => {
        const end = route.route[index + 1]
        return end && point.z !== end.z &&
          point.toNextSegmentType === "through_obstacle" &&
          Math.hypot(end.x - via.center.x, end.y - via.center.y) <= 1e-9 &&
          !route.vias.some((explicit) =>
            Math.hypot(explicit.x - via.center.x, explicit.y - via.center.y) <= 1e-9,
          )
      })
      if (existingCopper) continue
      const center = {
        x: params.center.x + (via.center.x - params.center.x) / params.coordinateScale,
        y: params.center.y + (via.center.y - params.center.y) / params.coordinateScale,
      }
      // Grow/shrink scales coordinates, while the emitted pad diameter stays physical.
      const radius = Math.max(via.diameter, params.viaDiameter ?? 0) / 2
      const minZ = params.allowBlindAndBuriedVias ? via.minZ : 0
      const maxZ = params.allowBlindAndBuriedVias ? via.maxZ : params.layerCount - 1
      for (const obstacle of params.obstacles) {
        const layers = obstacle.zLayers ?? obstacle.__zLayers ??
          obstacle.layers.map((layer) => mapLayerNameToZ(layer, params.layerCount))
        if (!layers.some((z) => z >= minZ && z <= maxZ)) continue
        const rotation = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
        const dx = center.x - obstacle.center.x
        const dy = center.y - obstacle.center.y
        const x = dx * Math.cos(rotation) - dy * Math.sin(rotation)
        const y = dx * Math.sin(rotation) + dy * Math.cos(rotation)
        const distance = obstacle.shape === "circle"
          ? Math.max(0, Math.hypot(dx, dy) - obstacle.width / 2)
          : Math.hypot(
              Math.max(0, Math.abs(x) - obstacle.width / 2),
              Math.max(0, Math.abs(y) - obstacle.height / 2),
            )
        if (distance + 1e-9 >= radius + params.viaToPadClearance) continue
        if (!isObstacleConnectedToRoute(obstacle, route, params.connMap)) return true
      }
    }
  }
  return false
}
