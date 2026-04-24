import type { ConnectionPoint } from "lib/types"
import { isPointInNode } from "lib/utils/capacityMeshNodeGeometry"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { sharedZLayers } from "./sharedZLayers"
import type { RegionHg } from "./types"

/** Checks whether a connection endpoint lies inside a region on at least one shared layer. */
export function checkIfConnectionPointIsInRegion(params: {
  point: ConnectionPoint
  region: RegionHg
  layerCount: number
}): boolean {
  if (isPointInNode(params.point, params.region.d)) {
    const layers =
      "layers" in params.point ? params.point.layers : [params.point.layer]
    const intLayers = layers.map((layer) => {
      return mapLayerNameToZ(layer, params.layerCount)
    })
    const sharedLayers = sharedZLayers(intLayers, params.region.d.availableZ)
    if (sharedLayers.length > 0) {
      return true
    }
  }
  return false
}
