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
      pointZLayers.some((z) => port.region1.d.availableZ.includes(z)) &&
      pointZLayers.some((z) => port.region2.d.availableZ.includes(z)),
  )
}
