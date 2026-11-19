import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import type { SimpleRouteJson } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import {
  convertPreloadedTraceToHdRoutes,
  type PreloadedHighDensityRoute,
} from "./convertPreloadedTraceToHdRoutes"
import {
  arePipeline9RoutesOnSameNet,
  getPipeline9RouteCopperGeometry,
} from "./pipeline9FixedRouteCopper"

type Point = { x: number; y: number }
type CopperPrimitive = {
  route: PreloadedHighDensityRoute
  start: Point
  end: Point
  minZ: number
  maxZ: number
  radius: number
}
type PreloadedCopperInput = {
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  traceWidth: number
  viaDiameter: number
}
type PortBlockerLookup = (
  point: Pick<PortPoint, "x" | "y" | "z">,
  options?: { includeClearance?: boolean },
) => PreloadedHighDensityRoute[]
type PortValidator = (
  point: PortPoint,
  options?: { includeClearance?: boolean },
) => boolean

/** Find copper whose clearance envelope covers a board-world crossing. */
export function createPreloadedPortBlockerLookup({
  srj,
  connMap,
  traceWidth,
  viaDiameter,
}: PreloadedCopperInput): PortBlockerLookup {
  if (!srj.traces?.length) return () => []
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
  const clearance =
    srj.minTraceToPadEdgeClearance ??
    srj.defaultObstacleMargin ??
    RELAXED_DRC_OPTIONS.traceClearance
  return (point, options): boolean => {
    const radius =
      traceWidth / 2 + (options?.includeClearance === false ? 0 : clearance)
    return index
      .search(
        point.x - radius,
        point.y - radius,
        point.x + radius,
        point.y + radius,
      )
      .filter(
        (primitive) =>
          point.z >= primitive.minZ &&
          point.z <= primitive.maxZ &&
          pointToSegmentDistance(point, primitive.start, primitive.end) <
            primitive.radius + radius,
      )
      .map((primitive) => primitive.route)
  }
}

/** Validate crossings against preloaded wire and via copper. */
export function createPreloadedPortValidator(
  input: PreloadedCopperInput,
): PortValidator {
  const getBlockers = createPreloadedPortBlockerLookup(input)
  return (point, options): boolean =>
    getBlockers(point, options).every((route) =>
      arePipeline9RoutesOnSameNet(point, route, input.connMap),
    )
}
