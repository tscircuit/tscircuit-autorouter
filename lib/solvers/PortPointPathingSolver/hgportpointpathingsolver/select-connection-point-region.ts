import type { ConnectionPoint } from "lib/types"
import type { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import {
  checkIfConnectionPointIsInRegion,
  CONNECTION_POINT_REGION_TOLERANCE,
} from "./checkIfConnectionPointIsInRegion"
import { getConnectionPointZLayers } from "./get-connection-point-z-layers"
import { hasIncidentPortOnConnectionPointLayer } from "./has-incident-port-on-connection-point-layer"
import type { RegionHg } from "./types"

export type IndexedRegionHg = {
  index: number
  region: RegionHg
}

type SelectConnectionPointRegionParams = {
  regionIndex: FlatbushIndex<IndexedRegionHg>
  point: ConnectionPoint
  layerCount: number
}

export function selectConnectionPointRegion({
  regionIndex,
  point,
  layerCount,
}: SelectConnectionPointRegionParams): RegionHg | undefined {
  const tolerance = CONNECTION_POINT_REGION_TOLERANCE
  const candidates = regionIndex
    .search(
      point.x - tolerance,
      point.y - tolerance,
      point.x + tolerance,
      point.y + tolerance,
    )
    .sort((left, right) => left.index - right.index)
    .map(({ region }) => region)
    .filter((region) =>
      checkIfConnectionPointIsInRegion({
        point,
        region,
        layerCount,
      }),
    )
  const pointZLayers = getConnectionPointZLayers({ point, layerCount })

  return (
    candidates.find((region) =>
      hasIncidentPortOnConnectionPointLayer({ region, pointZLayers }),
    ) ?? candidates[0]
  )
}
