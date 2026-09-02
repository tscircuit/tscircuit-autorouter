import type { SimplifiedPcbTrace } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { type LayerName, mapZToLayerName } from "lib/utils/mapZToLayerName"

type ViaRoutePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "via" }
>

export const getViaLayerNames = ({
  via,
  layerCount,
}: {
  via: ViaRoutePoint
  layerCount: number
}): LayerName[] => {
  if (via.layers?.length) {
    return via.layers.map((layerName) =>
      mapZToLayerName(mapLayerNameToZ(layerName, layerCount), layerCount),
    )
  }

  const fromZ = mapLayerNameToZ(via.from_layer, layerCount)
  const toZ = mapLayerNameToZ(via.to_layer, layerCount)
  const minZ = Math.min(fromZ, toZ)
  const maxZ = Math.max(fromZ, toZ)

  return Array.from({ length: maxZ - minZ + 1 }, (_, index) =>
    mapZToLayerName(minZ + index, layerCount),
  )
}
