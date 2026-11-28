import type { Obstacle, SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"

/** Immutable copper in board-world millimetres (+X right, +Y up).
 * A wire capsule is the union of its center rectangle and circular end caps.
 * Logical via entry/exit layers do not shorten a physical through barrel.
 */
export function getFixedCopperObstacles(srj: SimpleRouteJson): Obstacle[] {
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const viaDiameter = getViaDimensions(srj).padDiameter
  const obstacles: Obstacle[] = []
  for (const [traceIndex, trace] of (srj.traces ?? []).entries()) {
    if (!trace.isFixed) continue
    const connectedTo = [trace.connection_name, ...(trace.connectsTo ?? [])].filter(id => id !== undefined)
    const routes = convertPreloadedTraceToHdRoutes(trace, traceIndex, srj.layerCount, viaDiameter, connMap)
    for (const [routeIndex, route] of routes.entries()) {
      const geometry = getPipeline9RouteCopperGeometry(route, srj)
      for (const [wireIndex, wire] of geometry.wireSegments.entries()) {
        const layers = [mapZToLayerName(wire.z, srj.layerCount)]
        const obstacleId = `${trace.pcb_trace_id}_copper_${routeIndex}_${wireIndex}`
        const dx = wire.end.x - wire.start.x
        const dy = wire.end.y - wire.start.y
        if (dx !== 0 || dy !== 0) {
          obstacles.push({
            obstacleId, type: "rect", layers, connectedTo,
            center: { x: (wire.start.x + wire.end.x) / 2, y: (wire.start.y + wire.end.y) / 2 },
            width: Math.hypot(dx, dy), height: wire.width,
            ccwRotationDegrees: Math.atan2(dy, dx) * 180 / Math.PI,
          })
        }
        for (const [capIndex, center] of [wire.start, wire.end].entries()) {
          obstacles.push({
            obstacleId: `${obstacleId}_cap_${capIndex}`, type: "rect", shape: "circle",
            center, width: wire.width, height: wire.width, layers, connectedTo,
          })
        }
      }
      for (const [viaIndex, via] of geometry.viaSpans.entries()) {
        obstacles.push({
          obstacleId: `${trace.pcb_trace_id}_barrel_${routeIndex}_${viaIndex}`,
          type: "rect", shape: "circle", center: via.center,
          width: via.diameter, height: via.diameter,
          layers: Array.from({ length: via.maxZ - via.minZ + 1 }, (_, offset) => mapZToLayerName(via.minZ + offset, srj.layerCount)),
          connectedTo,
        })
      }
    }
  }
  return obstacles
}
