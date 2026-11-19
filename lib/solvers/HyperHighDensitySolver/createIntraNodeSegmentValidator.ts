import type { StaticSegmentValidator } from "@tscircuit/high-density-a01"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getSegmentToObstacleDistance } from "lib/utils/getSegmentToObstacleDistance"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

/** Reuse native copper and pad geometry while A03 searches in physical coordinates. */
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
}): StaticSegmentValidator => {
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
    let minZ = Math.min(start.z, end.z)
    let maxZ = Math.max(start.z, end.z)
    let radius = segment.traceThickness / 2
    if (isVia) {
      radius = segment.viaDiameter / 2
      if (!allowBlindAndBuriedVias) {
        minZ = 0
        maxZ = layerCount - 1
      }
    }
    for (const obstacle of obstacles) {
      const connected = obstacle.connectedTo.some((connectionName) =>
        arePipeline9RoutesOnSameNet(route, { connectionName }, connMap),
      )
      if (connected) continue
      const sharesLayer = obstacle.layers.some((layer) => {
        const z = mapLayerNameToZ(layer, layerCount)
        return z >= minZ && z <= maxZ
      })
      if (!sharesLayer) continue
      const distance = getSegmentToObstacleDistance({ start, end, obstacle })
      if (distance < radius + clearance) return false
    }
    return true
  }
}
