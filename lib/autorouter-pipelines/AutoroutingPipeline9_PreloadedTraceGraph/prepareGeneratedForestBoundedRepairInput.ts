import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"

/**
 * Generated forest copper is immutable to bounded repair, but it is not user
 * preloaded copper. Represent its complete copper envelope as fixed obstacles
 * for that search. The caller's reference evaluator retains the actual traces.
 * A genuine user preload keeps the original bounded-repair exclusion intact.
 */
export function prepareGeneratedForestBoundedRepairInput(params: {
  originalSrj: SimpleRouteJson
  updatedPreloadedTraces: SimplifiedPcbTrace[]
  generatedFixedTraceIds: ReadonlySet<string>
  connMap: ConnectivityMap
  defaultViaDiameter: number
}): { srj: SimpleRouteJson; projectedTraceCount: number; primitiveCount: number } {
  const { originalSrj, updatedPreloadedTraces, generatedFixedTraceIds } = params
  if (generatedFixedTraceIds.size === 0 ||
    (originalSrj.traces ?? []).some((trace) => !generatedFixedTraceIds.has(trace.pcb_trace_id))) {
    return { srj: originalSrj, projectedTraceCount: 0, primitiveCount: 0 }
  }
  const generatedTraces = updatedPreloadedTraces.filter((trace) =>
    generatedFixedTraceIds.has(trace.pcb_trace_id))
  const materializedIds = new Set(generatedTraces.map((trace) => trace.pcb_trace_id))
  if (materializedIds.size !== generatedTraces.length)
    throw new Error("Generated forest repair input duplicated an owned copper branch")
  if (materializedIds.size !== generatedFixedTraceIds.size)
    throw new Error("Generated forest repair input lost an owned copper branch")
  const obstacles: Obstacle[] = []
  for (const [traceIndex, trace] of generatedTraces.entries()) {
    if (trace.route.some((point) => point.route_type !== "wire" && point.route_type !== "via"))
      throw new Error("Generated forest contains an unsupported fixed copper primitive")
    const routes = convertPreloadedTraceToHdRoutes(trace, traceIndex,
      originalSrj.layerCount, params.defaultViaDiameter, params.connMap)
    const before = obstacles.length
    const connectedTo = [trace.connection_name, ...(trace.connectsTo ?? [])]
    for (const route of routes) {
      const geometry = getPipeline9RouteCopperGeometry(route, originalSrj)
      for (const segment of geometry.wireSegments) {
        const dx = segment.end.x - segment.start.x
        const dy = segment.end.y - segment.start.y
        obstacles.push({
          obstacleId: `generated_forest_copper_${traceIndex}_${obstacles.length}`,
          type: "rect", layers: [mapZToLayerName(segment.z, originalSrj.layerCount)],
          center: { x: (segment.start.x + segment.end.x) / 2, y: (segment.start.y + segment.end.y) / 2 },
          // Extend both ends by a radius: the complete round-ended wire lies
          // inside this rotated rectangle, including its terminal caps.
          width: Math.hypot(dx, dy) + segment.width,
          height: segment.width,
          ccwRotationDegrees: Math.atan2(dy, dx) * 180 / Math.PI,
          connectedTo,
        })
      }
      for (const via of geometry.viaSpans) {
        obstacles.push({
          obstacleId: `generated_forest_copper_${traceIndex}_${obstacles.length}`,
          type: "rect",
          layers: Array.from({ length: via.maxZ - via.minZ + 1 }, (_, index) =>
            mapZToLayerName(via.minZ + index, originalSrj.layerCount)),
          center: { ...via.center }, width: via.diameter, height: via.diameter,
          connectedTo,
        })
      }
    }
    if (obstacles.length === before)
      throw new Error("Generated forest branch has no physical copper for bounded repair")
  }
  return {
    srj: { ...originalSrj, traces: undefined, obstacles: [...originalSrj.obstacles, ...obstacles] },
    projectedTraceCount: generatedTraces.length,
    primitiveCount: obstacles.length,
  }
}
