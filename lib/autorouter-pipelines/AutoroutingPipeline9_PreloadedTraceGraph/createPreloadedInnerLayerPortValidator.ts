import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute, PortPoint } from "lib/types/high-density-types"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"
import {
  arePipeline9RoutesOnSameNet,
  getPipeline9RouteCopperGeometry,
} from "./pipeline9FixedRouteCopper"

type Point = { x: number; y: number }
type CopperPrimitive = {
  route: HighDensityRoute
  start: Point
  end: Point
  minZ: number
  maxZ: number
  radius: number
}
type PortValidator = (point: PortPoint) => boolean

/** Inner-layer crossings are not bounded by the surface-pad mesh. */
export function createPreloadedInnerLayerPortValidator({
  srj,
  connMap,
  traceWidth,
  viaDiameter,
}: {
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  traceWidth: number
  viaDiameter: number
}): PortValidator {
  if (!srj.traces?.length || srj.layerCount <= 2) return () => true
  const copper: CopperPrimitive[] = srj.traces.flatMap((trace, index) =>
    convertPreloadedTraceToHdRoutes(
      trace,
      index,
      srj.layerCount,
      viaDiameter,
      connMap,
    ).flatMap((route) => {
      const geometry = getPipeline9RouteCopperGeometry(route, srj)
      return [
        ...geometry.wireSegments.map((wire) => ({
          route,
          start: wire.start,
          end: wire.end,
          minZ: wire.z,
          maxZ: wire.z,
          radius: wire.width / 2,
        })),
        ...geometry.viaSpans.map((via) => ({
          route,
          start: via.center,
          end: via.center,
          minZ: via.minZ,
          maxZ: via.maxZ,
          radius: via.diameter / 2,
        })),
      ]
    }),
  )
  if (copper.length === 0) return () => true
  const index = new FlatbushIndex<CopperPrimitive>(copper.length)
  for (const primitive of copper) {
    index.insert(
      primitive,
      Math.min(primitive.start.x, primitive.end.x) - primitive.radius,
      Math.min(primitive.start.y, primitive.end.y) - primitive.radius,
      Math.max(primitive.start.x, primitive.end.x) + primitive.radius,
      Math.max(primitive.start.y, primitive.end.y) + primitive.radius,
    )
  }
  index.finish()
  return (point): boolean => {
    if (point.z === 0 || point.z === srj.layerCount - 1) return true
    const radius = traceWidth / 2
    return index
      .search(
        point.x - radius,
        point.y - radius,
        point.x + radius,
        point.y + radius,
      )
      .every(
        (primitive) =>
          point.z < primitive.minZ ||
          point.z > primitive.maxZ ||
          arePipeline9RoutesOnSameNet(point, primitive.route, connMap) ||
          pointToSegmentDistance(point, primitive.start, primitive.end) >=
            primitive.radius + radius,
      )
  }
}
