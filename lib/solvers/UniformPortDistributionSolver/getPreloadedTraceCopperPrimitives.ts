import type { SimplifiedPcbTrace } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export interface PreloadedTraceCopperPrimitive {
  start: { x: number; y: number }
  end: { x: number; y: number }
  width: number
  z: number
  connectedIds: string[]
}

export const getPointToCopperPrimitiveDistance = (
  point: { x: number; y: number },
  primitive: PreloadedTraceCopperPrimitive,
): number => {
  const dx = primitive.end.x - primitive.start.x
  const dy = primitive.end.y - primitive.start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) {
    return Math.hypot(point.x - primitive.start.x, point.y - primitive.start.y)
  }
  const projection =
    ((point.x - primitive.start.x) * dx + (point.y - primitive.start.y) * dy) /
    lengthSquared
  const clampedProjection = Math.max(0, Math.min(1, projection))
  return Math.hypot(
    point.x - (primitive.start.x + clampedProjection * dx),
    point.y - (primitive.start.y + clampedProjection * dy),
  )
}

export const getPreloadedTraceCopperPrimitives = ({
  traces,
  layerCount,
  defaultViaDiameter,
}: {
  traces: SimplifiedPcbTrace[]
  layerCount: number
  defaultViaDiameter: number
}): PreloadedTraceCopperPrimitive[] => {
  const primitives: PreloadedTraceCopperPrimitive[] = []
  for (const trace of traces) {
    const connectedIds = [
      trace.pcb_trace_id,
      trace.connection_name,
      ...(trace.connectsTo ?? []),
    ]
    for (const routePoint of trace.route) {
      if (routePoint.route_type === "via") {
        const fromZ = mapLayerNameToZ(routePoint.from_layer, layerCount)
        const toZ = mapLayerNameToZ(routePoint.to_layer, layerCount)
        for (let z = Math.min(fromZ, toZ); z <= Math.max(fromZ, toZ); z++) {
          primitives.push({
            start: routePoint,
            end: routePoint,
            width: routePoint.via_diameter ?? defaultViaDiameter,
            z,
            connectedIds,
          })
        }
        continue
      }
      if (routePoint.route_type === "through_obstacle") {
        const fromZ = mapLayerNameToZ(routePoint.from_layer, layerCount)
        const toZ = mapLayerNameToZ(routePoint.to_layer, layerCount)
        for (let z = Math.min(fromZ, toZ); z <= Math.max(fromZ, toZ); z++) {
          primitives.push({
            start: routePoint.start,
            end: routePoint.end,
            width: routePoint.width,
            z,
            connectedIds,
          })
        }
      }
    }
    for (let index = 1; index < trace.route.length; index++) {
      const start = trace.route[index - 1]
      const end = trace.route[index]
      if (
        start?.route_type !== "wire" ||
        end?.route_type !== "wire" ||
        start.layer !== end.layer
      ) {
        continue
      }
      primitives.push({
        start,
        end,
        width: Math.max(start.width, end.width),
        z: mapLayerNameToZ(start.layer, layerCount),
        connectedIds,
      })
    }
  }
  return primitives
}
