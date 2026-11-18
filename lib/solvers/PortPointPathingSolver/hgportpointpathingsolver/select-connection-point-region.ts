import type { ConnectionPoint, Obstacle } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { checkIfConnectionPointIsInRegion } from "./checkIfConnectionPointIsInRegion"
import { getConnectionPointZLayers } from "./get-connection-point-z-layers"
import { hasIncidentPortOnConnectionPointLayer } from "./has-incident-port-on-connection-point-layer"
import type { HyperGraphHg, RegionHg } from "./types"

const VIA_IN_PAD_CENTER_TOLERANCE_MM = 1e-6

type SelectConnectionPointRegionParams = {
  graph: HyperGraphHg
  point: ConnectionPoint
  layerCount: number
  existingViaInPad?: Obstacle
}

export function selectConnectionPointRegion({
  graph,
  point,
  layerCount,
  existingViaInPad,
}: SelectConnectionPointRegionParams): RegionHg | undefined {
  const pointZLayers = getConnectionPointZLayers({ point, layerCount })
  const viaZLayers = existingViaInPad?.layers.map((layer) =>
    mapLayerNameToZ(layer, layerCount),
  )
  let firstCandidate: RegionHg | undefined
  let connectedCandidate: RegionHg | undefined
  let viaCandidate: RegionHg | undefined
  let connectedLayerCount = 0
  for (const region of graph.regions) {
    if (
      !checkIfConnectionPointIsInRegion({
        point,
        region,
        layerCount,
        pointZLayers,
      })
    ) {
      continue
    }
    firstCandidate ??= region
    if (hasIncidentPortOnConnectionPointLayer({ region, pointZLayers })) {
      if (!existingViaInPad) return region
      connectedCandidate ??= region
      if (
        !region.d._containsTarget ||
        Math.abs(region.d.center.x - existingViaInPad.center.x) >
          VIA_IN_PAD_CENTER_TOLERANCE_MM ||
        Math.abs(region.d.center.y - existingViaInPad.center.y) >
          VIA_IN_PAD_CENTER_TOLERANCE_MM
      ) {
        continue
      }
      const sharedLayerCount = region.d.availableZ.filter((z) =>
        viaZLayers!.includes(z),
      ).length
      // Prefer existing multilayer terminal copper over its coincident surface
      // pad, which would force an unnecessary new escape via.
      if (sharedLayerCount > connectedLayerCount) {
        viaCandidate = region
        connectedLayerCount = sharedLayerCount
      }
    }
  }
  return viaCandidate ?? connectedCandidate ?? firstCandidate
}
