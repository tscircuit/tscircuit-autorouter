import { getConnectionPointLayers } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type {
  RouteMetadata,
  SharedConnectionZInput,
  SimpleRouteConnectionPoint,
} from "./types"

export const getRouteConnectionName = (routeMetadata: RouteMetadata): string =>
  routeMetadata.simpleRouteConnection?.name ?? routeMetadata.connectionId

export const getRouteRootConnectionName = (
  routeMetadata: RouteMetadata,
): string | undefined =>
  routeMetadata.simpleRouteConnection?.rootConnectionName ??
  routeMetadata.mutuallyConnectedNetworkId

export const getRoutePoint = (
  routeMetadata: RouteMetadata,
  endpointIndex: 0 | 1,
): SimpleRouteConnectionPoint | undefined =>
  routeMetadata.simpleRouteConnection?.pointsToConnect[endpointIndex]

export const getSharedConnectionZ = (
  sharedConnectionZInput: SharedConnectionZInput,
): number => {
  const point = getRoutePoint(
    sharedConnectionZInput.routeMetadata,
    sharedConnectionZInput.endpointIndex,
  )
  if (!point) {
    return sharedConnectionZInput.fallbackZ
  }

  const pointZLayers = getConnectionPointLayers(point).map((layerName) =>
    mapLayerNameToZ(layerName, sharedConnectionZInput.layerCount),
  )
  const sharedZ = sharedConnectionZInput.regionAvailableZ.find((z) =>
    pointZLayers.includes(z),
  )

  return sharedZ ?? sharedConnectionZInput.fallbackZ
}
