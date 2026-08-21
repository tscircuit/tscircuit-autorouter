import { pointToBoxDistance } from "@tscircuit/math-utils";
import type { ConnectionPoint } from "lib/types";
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ";
import { sharedZLayers } from "./sharedZLayers";
import type { RegionHg } from "./types";

const CONNECTION_POINT_REGION_TOLERANCE = 1e-3;

/** Checks whether a connection endpoint lies inside a region on at least one shared layer. */
export function checkIfConnectionPointIsInRegion(params: {
  point: ConnectionPoint;
  region: RegionHg;
  layerCount: number;
}): boolean {
  // Treat near-boundary endpoints as inside the region to avoid false
  // negatives from tiny coordinate drift between topology and connection data.
  if (
    pointToBoxDistance(params.point, params.region.d) <=
    CONNECTION_POINT_REGION_TOLERANCE
  ) {
    const layers =
      "layers" in params.point ? params.point.layers : [params.point.layer];
    const intLayers = layers.map((layer) => {
      return mapLayerNameToZ(layer, params.layerCount);
    });
    const sharedLayers = sharedZLayers(intLayers, params.region.d.availableZ);
    if (sharedLayers.length > 0) {
      return true;
    }
  }
  return false;
}
