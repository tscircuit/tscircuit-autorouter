import type { ConnectionPoint } from "lib/types"
import { checkIfConnectionPointIsInRegion } from "./checkIfConnectionPointIsInRegion"
import { getConnectionPointZLayers } from "./get-connection-point-z-layers"
import { hasIncidentPortOnConnectionPointLayer } from "./has-incident-port-on-connection-point-layer"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { HyperGraphHg, RegionHg } from "./types"

type SelectConnectionPointRegionParams = {
  graph: HyperGraphHg
  point: ConnectionPoint
  layerCount: number
  allowedLayers?: readonly string[]
}

export function selectConnectionPointRegion({
  graph,
  point,
  layerCount,
  allowedLayers,
}: SelectConnectionPointRegionParams): RegionHg | undefined {
  const physicalPointZLayers = getConnectionPointZLayers({ point, layerCount })
  const allowedZ = allowedLayers?.map((layer) =>
    mapLayerNameToZ(layer, layerCount),
  )
  const pointZLayers =
    allowedZ === undefined
      ? physicalPointZLayers
      : physicalPointZLayers.filter((z) => allowedZ.includes(z))
  let firstCandidate: RegionHg | undefined
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
      return region
    }
  }
  return firstCandidate
}
