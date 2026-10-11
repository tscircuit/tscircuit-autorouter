import Flatbush from "flatbush"
import { checkIfConnectionPointIsInRegion } from "../hgportpointpathingsolver/checkIfConnectionPointIsInRegion"
import { getConnectionPointZLayers } from "../hgportpointpathingsolver/get-connection-point-z-layers"
import type {
  ConnectionHgWithSimpleRouteConnection,
  HgPortPointPathingSolverParams,
} from "../hgportpointpathingsolver/types"
import type { TinyRouteNetIndexer } from "./createTinyRouteNetIndexer"

type RegionNetInput = {
  params: Omit<HgPortPointPathingSolverParams, "connections"> & {
    connections: ConnectionHgWithSimpleRouteConnection[]
  }
  getNetIndex: TinyRouteNetIndexer
  useRegionSpatialIndex?: boolean
}

const nativeArrayIterator = Array.prototype[Symbol.iterator]
const nativeArrayMap = Array.prototype.map
const nativeArrayEvery = Array.prototype.every
const nativeArraySome = Array.prototype.some
const nativeArrayIncludes = Array.prototype.includes
const nativeArraySort = Array.prototype.sort
const REGION_QUERY_MARGIN = 1e-3 + 2e-6

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) =>
      descriptor.get === undefined && descriptor.set === undefined,
  )
}

function isOrdinaryArray(value: unknown): value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return false
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) return false
  return Object.entries(Object.getOwnPropertyDescriptors(value)).every(
    ([key, descriptor]) =>
      (key === "length" || String(Number(key)) === key) &&
      descriptor.get === undefined &&
      descriptor.set === undefined,
  )
}

function isBoundedCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= 1e9
  )
}

function createConnectionRegionIndex(
  params: RegionNetInput["params"],
): Flatbush | undefined {
  if (
    Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)?.value !==
      nativeArrayIterator ||
    Object.getOwnPropertyDescriptor(Array.prototype, "map")?.value !==
      nativeArrayMap ||
    Object.getOwnPropertyDescriptor(Array.prototype, "every")?.value !==
      nativeArrayEvery ||
    Object.getOwnPropertyDescriptor(Array.prototype, "some")?.value !==
      nativeArraySome ||
    Object.getOwnPropertyDescriptor(Array.prototype, "includes")?.value !==
      nativeArrayIncludes ||
    Object.getOwnPropertyDescriptor(Array.prototype, "sort")?.value !==
      nativeArraySort ||
    !isPlainDataRecord(params) ||
    !isPlainDataRecord(params.graph) ||
    !isOrdinaryArray(params.graph.regions) ||
    !isOrdinaryArray(params.connections) ||
    !Number.isInteger(params.layerCount) ||
    params.layerCount <= 0 ||
    params.graph.regions.length === 0
  ) {
    return undefined
  }

  for (const connection of params.connections) {
    if (
      !isPlainDataRecord(connection) ||
      !isPlainDataRecord(connection.simpleRouteConnection) ||
      !isOrdinaryArray(connection.simpleRouteConnection.pointsToConnect)
    ) {
      return undefined
    }
    for (const point of connection.simpleRouteConnection.pointsToConnect) {
      if (
        !isPlainDataRecord(point) ||
        !isBoundedCoordinate(point.x) ||
        !isBoundedCoordinate(point.y)
      ) {
        return undefined
      }
      if ("layer" in point) {
        if ("layers" in point || typeof point.layer !== "string") {
          return undefined
        }
      } else if (
        !isOrdinaryArray(point.layers) ||
        !point.layers.every((layer) => typeof layer === "string")
      ) {
        return undefined
      }
    }
  }

  const index = new Flatbush(params.graph.regions.length)
  for (const region of params.graph.regions) {
    if (
      !isPlainDataRecord(region) ||
      !isPlainDataRecord(region.d) ||
      !isPlainDataRecord(region.d.center) ||
      !isBoundedCoordinate(region.d.center.x) ||
      !isBoundedCoordinate(region.d.center.y) ||
      !isBoundedCoordinate(region.d.width) ||
      !isBoundedCoordinate(region.d.height) ||
      region.d.width < 0 ||
      region.d.height < 0 ||
      !isOrdinaryArray(region.d.availableZ) ||
      !region.d.availableZ.every((z) => typeof z === "number")
    ) {
      return undefined
    }
    const halfWidth = region.d.width / 2
    const halfHeight = region.d.height / 2
    index.add(
      region.d.center.x - halfWidth,
      region.d.center.y - halfHeight,
      region.d.center.x + halfWidth,
      region.d.center.y + halfHeight,
    )
  }
  index.finish()
  return index
}

export function getRegionNetIdByRegionId(
  input: RegionNetInput,
): Map<string, number> {
  // The wrapper opts in with a locally created net indexer that leaves geometry
  // unchanged. The padded query only rejects regions outside endpoint tolerance.
  // Direct callers keep their callback's original ordered scan semantics.
  const regionIndex = input.useRegionSpatialIndex
    ? createConnectionRegionIndex(input.params)
    : undefined
  const regionNetCandidates = new Map<string, Set<number>>()
  const alreadyConnectedEndpointRegionIds = new Set<string>()
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
      const pointZLayers = getConnectionPointZLayers({
        point,
        layerCount: input.params.layerCount,
      })
      const candidateRegionIndexes = regionIndex
        ?.search(
          point.x - REGION_QUERY_MARGIN,
          point.y - REGION_QUERY_MARGIN,
          point.x + REGION_QUERY_MARGIN,
          point.y + REGION_QUERY_MARGIN,
        )
        .sort((a, b) => a - b)
      const candidateRegions = candidateRegionIndexes
        ? candidateRegionIndexes.map(
            (regionIndex) => input.params.graph.regions[regionIndex]!,
          )
        : input.params.graph.regions
      for (const region of candidateRegions) {
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

  const regionNetIdByRegionId = new Map<string, number>()
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
  return regionNetIdByRegionId
}
