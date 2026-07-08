import { sharedZLayers } from "./sharedZLayers"
import type { RegionHg } from "./types"

type HasIncidentPortOnConnectionPointLayerParams = {
  region: RegionHg
  pointZLayers: number[]
}

export function hasIncidentPortOnConnectionPointLayer({
  region,
  pointZLayers,
}: HasIncidentPortOnConnectionPointLayerParams): boolean {
  return region.ports.some(
    (port) =>
      pointZLayers.includes(port.d.z) &&
      sharedZLayers(pointZLayers, port.region1.d.availableZ).length > 0 &&
      sharedZLayers(pointZLayers, port.region2.d.availableZ).length > 0,
  )
}
