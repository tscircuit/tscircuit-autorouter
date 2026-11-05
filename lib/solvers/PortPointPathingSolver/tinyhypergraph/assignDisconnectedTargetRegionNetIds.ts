import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
} from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import { assertDefined } from "../hgportpointpathingsolver/assertDefined"
import type {
  ConnectionHgWithSimpleRouteConnection,
  RegionHg,
  RegionId,
  RegionPortHg,
} from "../hgportpointpathingsolver/types"
import type { TinyRouteNetIndexer } from "./createTinyRouteNetIndexer"

export type ConnectionAlias =
  ConnectionHgWithSimpleRouteConnection["connectionId"]

export function assignDisconnectedTargetRegionNetIds(input: {
  regions: RegionHg[]
  connections: ConnectionHgWithSimpleRouteConnection[]
  regionNetIdByRegionId: Map<RegionId, number>
  regionNetCandidates: ReadonlyMap<RegionId, ReadonlySet<number>>
  netIndexByConnectionAlias: ReadonlyMap<ConnectionAlias, number>
  getNetIndex: TinyRouteNetIndexer
}): void {
  const regionById = new Map<RegionId, RegionHg>(
    input.regions.map((region): [RegionId, RegionHg] => [
      region.regionId,
      region,
    ]),
  )
  for (const connection of input.connections) {
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
    // Existing routes keep their current conductive regions and exit choices.
    const terminalsAreConnected = areConnectionRegionsConnected({
      startRegion,
      endRegion,
      netId,
      regionById,
      regionNetIdByRegionId: input.regionNetIdByRegionId,
    })
    if (terminalsAreConnected) continue

    for (const endpoint of [startRegion, endRegion]) {
      const targetName = endpoint.d._targetConnectionName
      const endpointBelongsToNet =
        input.regionNetIdByRegionId.get(endpoint.regionId) === netId
      if (!endpointBelongsToNet || !endpoint.d._containsTarget || !targetName) {
        continue
      }
      const pending = [endpoint]
      const visited = new Set<RegionId>([endpoint.regionId])
      while (pending.length > 0) {
        const region = pending.pop()!
        for (const port of region.ports) {
          const neighbor = getNeighborRegionOrThrow({
            region,
            port,
            regionById,
          })
          if (visited.has(neighbor.regionId)) continue
          const isSameTargetPad =
            neighbor.d._containsObstacle &&
            neighbor.d._containsTarget &&
            neighbor.d._targetConnectionName === targetName
          if (!isSameTargetPad) continue

          const touchesForeignNet = neighbor.d._connectedTo?.some(
            (name: ConnectionAlias): boolean =>
              input.netIndexByConnectionAlias.get(name) !== netId,
          )
          if (touchesForeignNet) continue
          const candidates = input.regionNetCandidates.get(neighbor.regionId)
          const hasConflictingNetCandidates = candidates && candidates.size > 1
          if (hasConflictingNetCandidates) continue
          const neighborNetId = input.regionNetIdByRegionId.get(
            neighbor.regionId,
          )
          const belongsToAnotherNet =
            neighborNetId !== undefined && neighborNetId !== netId
          if (belongsToAnotherNet) continue

          const hasSharedBorder = areNodesBordering(region.d, neighbor.d)
          const sharedArea = getBoundsIntersection(
            getCapacityMeshNodeBounds(region.d),
            getCapacityMeshNodeBounds(neighbor.d),
          )
          const hasRoutingContact = hasSharedBorder || sharedArea !== null
          if (!hasRoutingContact) continue

          visited.add(neighbor.regionId)
          input.regionNetIdByRegionId.set(neighbor.regionId, netId)
          pending.push(neighbor)
        }
      }
    }
  }
}

function areConnectionRegionsConnected(input: {
  startRegion: RegionHg
  endRegion: RegionHg
  netId: number
  regionById: ReadonlyMap<RegionId, RegionHg>
  regionNetIdByRegionId: ReadonlyMap<RegionId, number>
}): boolean {
  const reachable = [input.startRegion]
  const visited = new Set<RegionId>([input.startRegion.regionId])
  for (const region of reachable) {
    if (region.regionId === input.endRegion.regionId) return true
    for (const port of region.ports) {
      const neighbor = getNeighborRegionOrThrow({
        region,
        port,
        regionById: input.regionById,
      })
      if (visited.has(neighbor.regionId)) continue
      const neighborNetId = input.regionNetIdByRegionId.get(neighbor.regionId)
      const hasAssignedNet = neighborNetId !== undefined && neighborNetId >= 0
      const belongsToAnotherNet =
        hasAssignedNet && neighborNetId !== input.netId
      if (belongsToAnotherNet) continue
      const isUnownedObstacle =
        neighbor.d._containsObstacle && neighborNetId !== input.netId
      const isEndRegion = neighbor.regionId === input.endRegion.regionId
      if (isUnownedObstacle && !isEndRegion) continue

      visited.add(neighbor.regionId)
      reachable.push(neighbor)
    }
  }
  return false
}

function getNeighborRegionOrThrow(input: {
  region: RegionHg
  port: RegionPortHg
  regionById: ReadonlyMap<RegionId, RegionHg>
}): RegionHg {
  let neighborId = input.port.region1.regionId
  const regionIsFirstPortSide = neighborId === input.region.regionId
  if (regionIsFirstPortSide) {
    neighborId = input.port.region2.regionId
  }
  const neighbor = input.regionById.get(neighborId)
  if (!neighbor) {
    throw new Error(
      `Port ${input.port.portId} references missing region ${neighborId}`,
    )
  }
  return neighbor
}
