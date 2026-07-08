import type { HgPortPointPathingSolverParams } from "../hgportpointpathingsolver/types"
import { checkIfConnectionPointIsInRegion } from "../hgportpointpathingsolver/checkIfConnectionPointIsInRegion"
import type { TinyRouteNetIndexer } from "./createTinyRouteNetIndexer"

export function getRegionNetIdByRegionId(input: {
  params: HgPortPointPathingSolverParams
  getNetIndex: TinyRouteNetIndexer
}): Map<string, number> {
  const regionNetCandidates = new Map<string, Set<number>>()
  for (const connection of input.params.connections) {
    const routeNetIndex = input.getNetIndex({
      connectionId: connection.connectionId,
      mutuallyConnectedNetworkId:
        connection.mutuallyConnectedNetworkId ?? connection.connectionId,
    })
    for (const point of connection.simpleRouteConnection?.pointsToConnect ??
      []) {
      for (const region of input.params.graph.regions) {
        if (
          !checkIfConnectionPointIsInRegion({
            point,
            region,
            layerCount: input.params.layerCount,
          })
        ) {
          continue
        }

        let netCandidates = regionNetCandidates.get(region.regionId)
        if (!netCandidates) {
          netCandidates = new Set<number>()
          regionNetCandidates.set(region.regionId, netCandidates)
        }
        netCandidates.add(routeNetIndex)
      }
    }
  }

  const regionNetIdByRegionId = new Map<string, number>()
  for (const [regionId, netCandidates] of regionNetCandidates) {
    if (netCandidates.size !== 1) continue
    regionNetIdByRegionId.set(regionId, [...netCandidates][0]!)
  }
  return regionNetIdByRegionId
}
