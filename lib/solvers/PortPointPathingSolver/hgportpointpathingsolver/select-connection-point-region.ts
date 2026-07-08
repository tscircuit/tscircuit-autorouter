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
  const candidates = graph.regions.filter((region) =>
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
