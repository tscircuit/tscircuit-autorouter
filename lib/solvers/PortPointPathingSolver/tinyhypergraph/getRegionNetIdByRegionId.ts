import { checkIfConnectionPointIsInRegion } from "../hgportpointpathingsolver/checkIfConnectionPointIsInRegion"
import { getConnectionPointZLayers } from "../hgportpointpathingsolver/get-connection-point-z-layers"
import type {
  ConnectionHgWithSimpleRouteConnection,
  HgPortPointPathingSolverParams,
  RegionId,
} from "../hgportpointpathingsolver/types"
import {
  assignDisconnectedTargetRegionNetIds,
  type ConnectionAlias,
} from "./assignDisconnectedTargetRegionNetIds"
import type { TinyRouteNetIndexer } from "./createTinyRouteNetIndexer"

export function getRegionNetIdByRegionId(input: {
  params: Pick<HgPortPointPathingSolverParams, "graph" | "layerCount"> & {
    connections: ConnectionHgWithSimpleRouteConnection[]
  }
  getNetIndex: TinyRouteNetIndexer
}): Map<RegionId, number> {
  const regionNetCandidates = new Map<RegionId, Set<number>>()
  const alreadyConnectedEndpointRegionIds = new Set<RegionId>()
  const netIndexByConnectionAlias = new Map<ConnectionAlias, number>()
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
      const pointZLayers = getConnectionPointZLayers({
        point,
        layerCount: input.params.layerCount,
      })
      for (const region of input.params.graph.regions) {
        if (
          !checkIfConnectionPointIsInRegion({
            point,
            region,
            layerCount: input.params.layerCount,
            pointZLayers,
          })
        ) {
          continue
        }

        const isDesiredConnectionEndpoint =
          point.pcb_port_id !== undefined || region.d._containsTarget === true
        if (!isDesiredConnectionEndpoint) {
          alreadyConnectedEndpointRegionIds.add(region.regionId)
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

  const regionNetIdByRegionId = new Map<RegionId, number>()
  for (const regionId of alreadyConnectedEndpointRegionIds) {
    // An endpoint that is already connected to copper only marks where desired
    // routing resumes; it does not make the surrounding region exclusive.
    // Store -1 so the loader does not infer ownership from connection start/end
    // regions. Desired connection endpoints and connected-copper regions are
    // assigned below.
    regionNetIdByRegionId.set(regionId, -1)
  }
  for (const [regionId, netCandidates] of regionNetCandidates) {
    if (netCandidates.size !== 1) continue
    regionNetIdByRegionId.set(regionId, [...netCandidates][0]!)
  }
  assignDisconnectedTargetRegionNetIds({
    regions: input.params.graph.regions,
    connections: input.params.connections,
    regionNetIdByRegionId,
    regionNetCandidates,
    netIndexByConnectionAlias,
    getNetIndex: input.getNetIndex,
  })
  return regionNetIdByRegionId
}
