import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
} from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import { assertDefined } from "../hgportpointpathingsolver/assertDefined"
import { checkIfConnectionPointIsInRegion } from "../hgportpointpathingsolver/checkIfConnectionPointIsInRegion"
import { getConnectionPointZLayers } from "../hgportpointpathingsolver/get-connection-point-z-layers"
import type {
  ConnectionHgWithSimpleRouteConnection,
  HgPortPointPathingSolverParams,
  RegionHg,
  RegionId,
  RegionPortHg,
} from "../hgportpointpathingsolver/types"
import type { TinyRouteNetIndexer } from "./createTinyRouteNetIndexer"

type ConnectionAlias = ConnectionHgWithSimpleRouteConnection["connectionId"]

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
  const regionById = new Map<RegionId, RegionHg>(
    input.params.graph.regions.map(
      (region): [RegionId, RegionHg] => [region.regionId, region],
    ),
  )
  for (const connection of input.params.connections) {
    const startRegion = regionById.get(connection.startRegion.regionId)
    const endRegion = regionById.get(connection.endRegion.regionId)
    assertDefined(
      startRegion,
      `Missing start region for ${connection.connectionId}`,
    )
    assertDefined(
      endRegion,
      `Missing end region for ${connection.connectionId}`,
    )
    const netId = input.getNetIndex(connection)
    const reachable = [startRegion]
    const checked = new Set<RegionId>([startRegion.regionId])
    let hasPath = false
    // Complete missing pad contacts only for disconnected terminal pairs.
    // Existing routes keep their current conductive regions and exit choices.
    for (const region of reachable) {
      if (region.regionId === endRegion.regionId) {
        hasPath = true
        break
      }
      for (const port of region.ports) {
        const neighbor = getNeighborRegionOrThrow({ region, port, regionById })
        if (checked.has(neighbor.regionId)) continue
        const owner = regionNetIdByRegionId.get(neighbor.regionId)
        if (owner !== undefined && owner >= 0 && owner !== netId) continue
        if (
          neighbor.d._containsObstacle &&
          owner !== netId &&
          neighbor.regionId !== endRegion.regionId
        ) {
          continue
        }
        checked.add(neighbor.regionId)
        reachable.push(neighbor)
      }
    }
    if (hasPath) continue

    for (const endpoint of [startRegion, endRegion]) {
      const targetName = endpoint.d._targetConnectionName
      if (
        regionNetIdByRegionId.get(endpoint.regionId) !== netId ||
        !endpoint.d._containsTarget ||
        !targetName
      ) {
        continue
      }
      const pending = [endpoint]
      const visited = new Set<RegionId>([endpoint.regionId])
      while (pending.length > 0) {
        const region = pending.pop()!
        for (const port of region.ports) {
          const neighbor = getNeighborRegionOrThrow({ region, port, regionById })
          if (
            visited.has(neighbor.regionId) ||
            !neighbor.d._containsObstacle ||
            !neighbor.d._containsTarget ||
            neighbor.d._targetConnectionName !== targetName ||
            neighbor.d._connectedTo?.some(
              (name: ConnectionAlias): boolean =>
                netIndexByConnectionAlias.get(name) !== netId,
            )
          ) {
            continue
          }
          const candidates = regionNetCandidates.get(neighbor.regionId)
          if (candidates && candidates.size > 1) continue
          const owner = regionNetIdByRegionId.get(neighbor.regionId)
          if (owner !== undefined && owner !== netId) continue
          if (
            !areNodesBordering(region.d, neighbor.d) &&
            !getBoundsIntersection(
              getCapacityMeshNodeBounds(region.d),
              getCapacityMeshNodeBounds(neighbor.d),
            )
          ) {
            continue
          }
          visited.add(neighbor.regionId)
          regionNetIdByRegionId.set(neighbor.regionId, netId)
          pending.push(neighbor)
        }
      }
    }
  }
  return regionNetIdByRegionId
}

function getNeighborRegionOrThrow(input: {
  region: RegionHg
  port: RegionPortHg
  regionById: ReadonlyMap<RegionId, RegionHg>
}): RegionHg {
  const neighborId =
    input.port.region1.regionId === input.region.regionId
      ? input.port.region2.regionId
      : input.port.region1.regionId
  const neighbor = input.regionById.get(neighborId)
  if (!neighbor) {
    throw new Error(
      `Port ${input.port.portId} references missing region ${neighborId}`,
    )
  }
  return neighbor
}
