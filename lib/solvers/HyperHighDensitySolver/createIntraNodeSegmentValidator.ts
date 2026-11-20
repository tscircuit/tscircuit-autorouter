import type { StaticSegmentValidator } from "@tscircuit/high-density-a01"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

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
  return (segment): boolean => {
    const route: HighDensityRoute = {
      ...segment,
      route: [segment.start, segment.end],
      vias: [],
    }
    if (segment.start.z !== segment.end.z) route.vias.push(segment.start)
    const radius =
      Math.max(segment.traceThickness, segment.viaDiameter) / 2 + clearance
    const bounds = {
      minX: Math.min(segment.start.x, segment.end.x) - radius,
      maxX: Math.max(segment.start.x, segment.end.x) + radius,
      minY: Math.min(segment.start.y, segment.end.y) - radius,
      maxY: Math.max(segment.start.y, segment.end.y) + radius,
    }
    for (const fixed of fixedHdRoutes) {
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
