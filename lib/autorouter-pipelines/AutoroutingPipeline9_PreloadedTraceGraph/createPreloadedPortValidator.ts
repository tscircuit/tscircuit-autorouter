import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import type { SimpleRouteJson } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import { getSegmentCapsuleInterval } from "lib/utils/getSegmentCapsuleInterval"
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
type PreloadedCopperLookup = {
  getBlockers: PortBlockerLookup
  getClearSpans: (segment: {
    start: Point
    end: Point
    z: number
  }) => Array<[number, number]>
}

/** Find copper whose clearance envelope covers a board-world crossing. */
export function createPreloadedCopperLookup({
  srj,
  connMap,
  traceWidth,
  viaDiameter,
}: PreloadedCopperInput): PreloadedCopperLookup {
  const copper: CopperPrimitive[] = (srj.traces ?? []).flatMap((trace, index) =>
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
  if (copper.length === 0) {
    return { getBlockers: () => [], getClearSpans: () => [[0, 1]] }
  }
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
  const getBlockers: PortBlockerLookup = (point, options) => {
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
  return {
    getBlockers,
    getClearSpans: ({ start, end, z }): Array<[number, number]> => {
      const radius = traceWidth / 2 + clearance
      const intervals = index
        .search(
          Math.min(start.x, end.x) - radius,
          Math.min(start.y, end.y) - radius,
          Math.max(start.x, end.x) + radius,
          Math.max(start.y, end.y) + radius,
        )
        .flatMap((primitive): Array<[number, number]> => {
          if (
            !primitive.route.isFixed ||
            z < primitive.minZ ||
            z > primitive.maxZ
          ) {
            return []
          }
          const interval = getSegmentCapsuleInterval({
            start,
            end,
            capsuleStart: primitive.start,
            capsuleEnd: primitive.end,
            radius: primitive.radius + radius,
          })
          if (!interval) return []
          return [interval]
        })
        .sort((a, b) => a[0] - b[0])
      const clearSpans: Array<[number, number]> = []
      let startFraction = 0
      for (const [entry, exit] of intervals) {
        if (entry > startFraction) clearSpans.push([startFraction, entry])
        startFraction = Math.max(startFraction, exit)
      }
      if (startFraction < 1) clearSpans.push([startFraction, 1])
      return clearSpans
    },
  }
}

/** Validate crossings against preloaded wire and via copper. */
export function createPreloadedPortValidator(
  input: PreloadedCopperInput,
): PortValidator {
  const { getBlockers } = createPreloadedCopperLookup(input)
  return (point, options): boolean =>
    getBlockers(point, options).every((route) =>
      arePipeline9RoutesOnSameNet(point, route, input.connMap),
    )
}
