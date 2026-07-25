import { checkIfConnectionPointIsInRegion } from "../hgportpointpathingsolver/checkIfConnectionPointIsInRegion"
import type {
  ConnectionHgWithSimpleRouteConnection,
  HgPortPointPathingSolverParams,
} from "../hgportpointpathingsolver/types"
import type { TinyRouteNetIndexer } from "./createTinyRouteNetIndexer"

export const BLOCKED_REGION_NET_ID = -2

const getFixedNetIndexerId = (fixedNetId: string) =>
  `__tscircuit_preloaded_fixed_net__:${JSON.stringify(fixedNetId)}`

export function getRegionNetIdByRegionId(input: {
  params: Omit<HgPortPointPathingSolverParams, "connections"> & {
    connections: ConnectionHgWithSimpleRouteConnection[]
  }
  getNetIndex: TinyRouteNetIndexer
}): Map<string, number> {
  const regionNetCandidates = new Map<string, Set<number>>()
  const netIndexByConnectionAlias = new Map<string, number>()
  const netIndexByOriginalCanonicalName = new Map<string, number>()
  for (const connection of input.params.connections) {
    const netId = connection.mutuallyConnectedNetworkId
    const routeNetIndex = input.getNetIndex({
      connectionId: connection.connectionId,
      mutuallyConnectedNetworkId: netId,
    })
    for (const connectionAlias of [connection.connectionId, netId]) {
      netIndexByConnectionAlias.set(connectionAlias, routeNetIndex)
    }
    const originalCanonicalNames = [
      connection.simpleRouteConnection.__netConnectionName,
      ...(connection.simpleRouteConnection.__rootConnectionNames ?? []),
    ].filter((name): name is string => Boolean(name))
    if (originalCanonicalNames.length === 0) {
      originalCanonicalNames.push(connection.simpleRouteConnection.name)
    }
    for (const originalCanonicalName of originalCanonicalNames) {
      netIndexByOriginalCanonicalName.set(originalCanonicalName, routeNetIndex)
    }
    for (const point of connection.simpleRouteConnection.pointsToConnect) {
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

  const fixedNetIndexByCanonicalNetId = new Map<string, number>()
  for (const region of input.params.graph.regions) {
    const fixedNetCandidates = new Set<number>()
    const hasPreloadedFixedCopper =
      (region.d._preloadedFixedNetIds?.length ?? 0) > 0
    for (const connectionName of region.d._connectedTo ?? []) {
      let routeNetIndex = netIndexByConnectionAlias.get(connectionName)
      if (routeNetIndex === undefined) {
        if (!hasPreloadedFixedCopper) continue
        routeNetIndex = input.getNetIndex({
          connectionId: connectionName,
          mutuallyConnectedNetworkId: connectionName,
        })
        netIndexByConnectionAlias.set(connectionName, routeNetIndex)
      }

      let netCandidates = regionNetCandidates.get(region.regionId)
      if (!netCandidates) {
        netCandidates = new Set<number>()
        regionNetCandidates.set(region.regionId, netCandidates)
      }
      netCandidates.add(routeNetIndex)
    }

    for (const fixedNetId of region.d._preloadedFixedNetIds ?? []) {
      let routeNetIndex = netIndexByOriginalCanonicalName.get(fixedNetId)
      if (routeNetIndex === undefined) {
        routeNetIndex = fixedNetIndexByCanonicalNetId.get(fixedNetId)
      }
      if (routeNetIndex === undefined) {
        const fixedNetIndexerId = getFixedNetIndexerId(fixedNetId)
        routeNetIndex = input.getNetIndex({
          connectionId: fixedNetIndexerId,
          mutuallyConnectedNetworkId: fixedNetIndexerId,
        })
        fixedNetIndexByCanonicalNetId.set(fixedNetId, routeNetIndex)
      }

      let netCandidates = regionNetCandidates.get(region.regionId)
      if (!netCandidates) {
        netCandidates = new Set<number>()
        regionNetCandidates.set(region.regionId, netCandidates)
      }
      netCandidates.add(routeNetIndex)
      fixedNetCandidates.add(routeNetIndex)
    }

    const netCandidates = regionNetCandidates.get(region.regionId)
    if (
      netCandidates &&
      fixedNetCandidates.size > 0 &&
      netCandidates.size > 1
    ) {
      // A region occupied by multiple fixed nets (or by fixed copper plus an
      // unrelated active net) is not a free ambiguous region. Reserve it for
      // every route so no net can incorrectly traverse the conflict.
      regionNetCandidates.set(region.regionId, new Set([BLOCKED_REGION_NET_ID]))
    }
  }

  const regionNetIdByRegionId = new Map<string, number>()
  for (const [regionId, netCandidates] of regionNetCandidates) {
    if (netCandidates.size !== 1) continue
    regionNetIdByRegionId.set(regionId, [...netCandidates][0]!)
  }
  return regionNetIdByRegionId
}
