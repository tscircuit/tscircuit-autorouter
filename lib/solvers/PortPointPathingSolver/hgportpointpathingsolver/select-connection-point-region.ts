import type { ConnectionPoint } from "lib/types"
import type { ConnectionPointRegionIndex } from "./ConnectionPointRegionIndex"
import { getConnectionPointZLayers } from "./get-connection-point-z-layers"
import { hasIncidentPortOnConnectionPointLayer } from "./has-incident-port-on-connection-point-layer"
import type { RegionHg } from "./types"

type SelectConnectionPointRegionParams = {
  point: ConnectionPoint
  layerCount: number
  regionIndex: ConnectionPointRegionIndex
}

export function selectConnectionPointRegion({
  point,
  layerCount,
  regionIndex,
}: SelectConnectionPointRegionParams): RegionHg | undefined {
  const candidates = regionIndex.getRegionsContainingPoint(point)
  const pointZLayers = getConnectionPointZLayers({ point, layerCount })

  return (
    candidates.find((region) =>
      hasIncidentPortOnConnectionPointLayer({ region, pointZLayers }),
    ) ?? candidates[0]
  )
}
