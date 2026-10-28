import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityIntraNodeRoute, ViaPlacementValidator } from "lib/types/high-density-types"

/** Check every actual manufactured transition, including closed-form and cached candidates. */
export const areRouteViasAllowed = (
  route: HighDensityIntraNodeRoute,
  validator: ViaPlacementValidator,
  layerCount: number,
  allowBlindAndBuriedVias?: boolean,
): boolean => {
  const geometry = getPipeline9RouteCopperGeometry(route, { layerCount, allowBlindAndBuriedVias })
  return geometry.viaSpans.every((via) => validator({
    ...via.center, zStart: via.minZ, zEnd: via.maxZ, viaDiameter: via.diameter,
  }, route.connectionName))
}
