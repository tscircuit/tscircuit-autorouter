import { segmentToBoundsMinDistance, segmentToCircleMinDistance } from "@tscircuit/math-utils"
import type { JointLayerAssignmentParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointLayerAssignmentSolver"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

// Frozen pre-broadphase predicate from b0150d171f2f634ac51a7499062be3e1e0d13d23.
// Retain its obstacle-first loops and arithmetic as a differential oracle.
export const getOriginalJointLayerStaticConflict = (
  route: HighDensityRoute, params: JointLayerAssignmentParams,
): { conflict: boolean; distances: number } => {
  let distances = 0
  const geometry = getPipeline9RouteCopperGeometry(route, params)
  for (const obstacle of params.obstacles ?? []) {
    const ids = [route.connectionName, route.rootConnectionName].filter((id): id is string => !!id)
    if (ids.some((id) => obstacle.connectedTo.some((other) =>
      id === other || params.connMap.areIdsConnected(id, other)))) continue
    const angle = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
    const local = (point: { x: number; y: number }): { x: number; y: number } => {
      const x = point.x - obstacle.center.x, y = point.y - obstacle.center.y
      return { x: x * Math.cos(angle) - y * Math.sin(angle),
        y: x * Math.sin(angle) + y * Math.cos(angle) }
    }
    const distance = (start: { x: number; y: number }, end: { x: number; y: number }): number => {
      distances++
      return obstacle.shape === "circle"
        ? segmentToCircleMinDistance(start, end, { ...obstacle.center,
            radius: Math.max(obstacle.width, obstacle.height) / 2 })
        : segmentToBoundsMinDistance(local(start), local(end), {
            minX: -obstacle.width / 2, maxX: obstacle.width / 2,
            minY: -obstacle.height / 2, maxY: obstacle.height / 2 })
    }
    for (const wire of geometry.wireSegments) {
      if (obstacle.layers.includes(mapZToLayerName(wire.z, params.layerCount)) &&
        distance(wire.start, wire.end) + 1e-9 < wire.width / 2 + params.clearance)
        return { conflict: true, distances }
    }
    for (const via of geometry.viaSpans) {
      const touchesLayer = Array.from({ length: via.maxZ - via.minZ + 1 }, (_, i) =>
        mapZToLayerName(via.minZ + i, params.layerCount)).some((layer) => obstacle.layers.includes(layer))
      if (touchesLayer && distance(via.center, via.center) + 1e-9 <
        via.diameter / 2 + (params.viaToPadClearance ?? params.clearance))
        return { conflict: true, distances }
    }
  }
  return { conflict: false, distances }
}
