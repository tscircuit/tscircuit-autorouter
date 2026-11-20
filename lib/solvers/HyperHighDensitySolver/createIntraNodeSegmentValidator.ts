import type { StaticSegmentValidator } from "@tscircuit/high-density-a01"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9RouteCopperGeometry,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"

/** Reuse native copper validation while A03 searches in physical coordinates. */
export const createIntraNodeSegmentValidator = ({
  fixedHdRoutes,
  connMap,
  layerCount,
  clearance,
  allowBlindAndBuriedVias,
}: {
  fixedHdRoutes: HighDensityRoute[]
  connMap: ConnectivityMap
  layerCount: number
  clearance: number
  allowBlindAndBuriedVias?: boolean
}): StaticSegmentValidator => {
  const copper = fixedHdRoutes.flatMap((route) => {
    const geometry = getPipeline9RouteCopperGeometry(route, {
      layerCount,
      allowBlindAndBuriedVias,
    })
    return [
      ...geometry.wireSegments.map((wire) => ({
        route,
        start: wire.start,
        end: wire.end,
        radius: wire.width / 2,
      })),
      ...geometry.viaSpans.map((via) => ({
        route,
        start: via.center,
        end: via.center,
        radius: via.diameter / 2,
      })),
    ]
  })
  let index: FlatbushIndex<HighDensityRoute> | undefined
  if (copper.length > 0) {
    index = new FlatbushIndex<HighDensityRoute>(copper.length)
    for (const primitive of copper) {
      index.insert(
        primitive.route,
        Math.min(primitive.start.x, primitive.end.x) - primitive.radius,
        Math.min(primitive.start.y, primitive.end.y) - primitive.radius,
        Math.max(primitive.start.x, primitive.end.x) + primitive.radius,
        Math.max(primitive.start.y, primitive.end.y) + primitive.radius,
      )
    }
    index.finish()
  }
  return (segment): boolean => {
    if (!index) return true
    const route: HighDensityRoute = {
      ...segment,
      route: [segment.start, segment.end],
      vias: [],
    }
    if (segment.start.z !== segment.end.z) route.vias.push(segment.start)
    let copperRadius = segment.traceThickness / 2
    if (segment.start.z !== segment.end.z) {
      copperRadius = Math.max(copperRadius, segment.viaDiameter / 2)
    }
    const radius = copperRadius + clearance
    const bounds = {
      minX: Math.min(segment.start.x, segment.end.x) - radius,
      maxX: Math.max(segment.start.x, segment.end.x) + radius,
      minY: Math.min(segment.start.y, segment.end.y) - radius,
      maxY: Math.max(segment.start.y, segment.end.y) + radius,
    }
    const nearbyRoutes = new Set(
      index.search(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY),
    )
    for (const fixed of nearbyRoutes) {
      if (arePipeline9RoutesOnSameNet(route, fixed, connMap)) continue
      if (
        doPipeline9RoutesHaveCopperConflict({
          left: fixed,
          right: route,
          leftBounds: bounds,
          clearance,
          layerCount,
          allowBlindAndBuriedVias,
        })
      ) {
        return false
      }
    }
    return true
  }
}
