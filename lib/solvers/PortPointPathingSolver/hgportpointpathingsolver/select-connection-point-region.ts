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
