import type {
  ConnectionHgWithSimpleRouteConnection,
  HgPortPointPathingSolverParams,
} from "../hgportpointpathingsolver/types"
import { checkIfConnectionPointIsInRegion } from "../hgportpointpathingsolver/checkIfConnectionPointIsInRegion"
import type { TinyRouteNetIndexer } from "./createTinyRouteNetIndexer"

export function getRegionNetIdByRegionId(input: {
  params: Omit<HgPortPointPathingSolverParams, "connections"> & {
    connections: ConnectionHgWithSimpleRouteConnection[]
  }
  getNetIndex: TinyRouteNetIndexer
}): Map<string, number> {
  const regionNetCandidates = new Map<string, Set<number>>()
  const netIndexByConnectionAlias = new Map<string, number>()
  for (const connection of input.params.connections) {
    const netId = connection.mutuallyConnectedNetworkId
    const routeNetIndex = input.getNetIndex({
      connectionId: connection.connectionId,
      mutuallyConnectedNetworkId: netId,
    })
    for (const connectionAlias of [connection.connectionId, netId]) {
      netIndexByConnectionAlias.set(connectionAlias, routeNetIndex)
    }
    for (const point of connection.simpleRouteConnection.pointsToConnect) {
      for (const region of input.params.graph.regions) {
        if (region.d._skipEndpointNetReservation) continue
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

  for (const region of input.params.graph.regions) {
    for (const connectionName of region.d._connectedTo ?? []) {
      const routeNetIndex = netIndexByConnectionAlias.get(connectionName)
      if (routeNetIndex === undefined) continue

      let netCandidates = regionNetCandidates.get(region.regionId)
      if (!netCandidates) {
        netCandidates = new Set<number>()
        regionNetCandidates.set(region.regionId, netCandidates)
      }
      netCandidates.add(routeNetIndex)
    }
  }

  const regionNetIdByRegionId = new Map<string, number>()
  for (const [regionId, netCandidates] of regionNetCandidates) {
    if (netCandidates.size !== 1) continue
    regionNetIdByRegionId.set(regionId, [...netCandidates][0]!)
  }
  return regionNetIdByRegionId
}
