import type { StaticRouteSegment } from "@tscircuit/high-density-a01"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getSegmentToObstacleDistance } from "lib/utils/getSegmentToObstacleDistance"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

/** Constrain grid moves with the same physical copper used by final validation. */
export const createIntraNodeSegmentValidator = ({
  fixedHdRoutes,
  obstacles,
  connMap,
  layerCount,
  clearance,
  allowBlindAndBuriedVias,
}: {
  fixedHdRoutes: HighDensityRoute[]
  obstacles: Obstacle[]
  connMap: ConnectivityMap
  layerCount: number
  clearance: number
  allowBlindAndBuriedVias?: boolean
}): ((segment: StaticRouteSegment) => boolean) => {
  return (segment): boolean => {
    const { start, end } = segment
    const isVia = start.z !== end.z
    const route: HighDensityRoute = {
      ...segment,
      route: [start, end],
      vias: [],
    }
    if (isVia) route.vias.push(start)
    for (const fixed of fixedHdRoutes) {
      if (arePipeline9RoutesOnSameNet(route, fixed, connMap)) continue
      if (
        doPipeline9RoutesHaveCopperConflict({
          left: route,
          right: fixed,
          clearance,
          layerCount,
          allowBlindAndBuriedVias,
        })
      ) {
        return false
      }
    }
    for (const obstacle of obstacles) {
      const sharesNet = obstacle.connectedTo.some((connectionName) =>
        arePipeline9RoutesOnSameNet(route, { connectionName }, connMap),
      )
      if (sharesNet) continue
      const layers =
        obstacle.__zLayers ??
        obstacle.zLayers ??
        obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
      if (!isVia && !layers.includes(start.z)) continue
      const distance = getSegmentToObstacleDistance({ start, end, obstacle })
      let radius = segment.traceThickness / 2
      if (isVia) radius = segment.viaDiameter / 2
      if (distance < radius + clearance) return false
    }
    return true
  }
}
