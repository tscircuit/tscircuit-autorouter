import { pointToBoxDistance } from "@tscircuit/math-utils"
import type { ConnectionPoint } from "lib/types"
import { getConnectionPointZLayers } from "./get-connection-point-z-layers"
import type { RegionHg } from "./types"

export const CONNECTION_POINT_REGION_TOLERANCE = 1e-3

/** Checks whether a connection endpoint lies inside a region on at least one shared layer. */
export function checkIfConnectionPointIsInRegion(params: {
  point: ConnectionPoint
  region: RegionHg
  layerCount: number
  pointZLayers?: number[]
}): boolean {
  // Treat near-boundary endpoints as inside the region to avoid false
  // negatives from tiny coordinate drift between topology and connection data.
  if (
    pointToBoxDistance(params.point, params.region.d) <=
    CONNECTION_POINT_REGION_TOLERANCE
  ) {
    const pointZLayers =
      params.pointZLayers ?? getConnectionPointZLayers(params)
    return pointZLayers.some((z) => params.region.d.availableZ.includes(z))
  }
  return false
}
