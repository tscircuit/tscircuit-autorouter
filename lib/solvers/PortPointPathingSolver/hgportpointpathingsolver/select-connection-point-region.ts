import type { ConnectionPoint } from "lib/types"
import { checkIfConnectionPointIsInRegion } from "./checkIfConnectionPointIsInRegion"
import { getConnectionPointZLayers } from "./get-connection-point-z-layers"
import { hasIncidentPortOnConnectionPointLayer } from "./has-incident-port-on-connection-point-layer"
import type { HyperGraphHg, RegionHg } from "./types"

type SelectConnectionPointRegionParams = {
  graph: HyperGraphHg
  point: ConnectionPoint
  layerCount: number
}

export function selectConnectionPointRegion({
  graph,
  point,
  layerCount,
}: SelectConnectionPointRegionParams): RegionHg | undefined {
  const pointZLayers = getConnectionPointZLayers({ point, layerCount })
  let firstCandidate: RegionHg | undefined
  let connectedCandidate: RegionHg | undefined
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
      const sharedLayerCount = region.d.availableZ.filter((z) =>
        pointZLayers.includes(z),
      ).length
      // Prefer existing multilayer terminal copper over its coincident surface
      // pad, which would force an unnecessary new escape via.
      if (sharedLayerCount > connectedLayerCount) {
        connectedCandidate = region
        connectedLayerCount = sharedLayerCount
      }
    }
  }
  return connectedCandidate ?? firstCandidate
}
