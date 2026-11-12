import { pointToBoxDistance } from "@tscircuit/math-utils"
import {
  Pipeline9RegionalFallbackSolver,
  isPipeline9ObstacleConnectedToRoute,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { getRoundPadClearanceSnapshot } from "./roundPadClearanceSnapshot"

type RegionalInput = ConstructorParameters<
  typeof Pipeline9RegionalFallbackSolver
>[0]
type ClearanceWitness = Parameters<
  typeof getRoundPadClearanceSnapshot
>[0]["witness"]

export const getClosestRegionalViaPadWitness = ({
  input,
  routes,
  accepted,
}: {
  input: RegionalInput
  routes: HighDensityRoute[]
  accepted: boolean
}): ClearanceWitness => {
  const { boardObstacles, movablePreloadedConnectionNames } = input
  if (!boardObstacles || !movablePreloadedConnectionNames) {
    throw new Error("Expected board obstacles and movable DDR routes")
  }
  let closest: ClearanceWitness | undefined
  for (const route of routes) {
    if (!movablePreloadedConnectionNames.has(route.connectionName)) continue
    for (const via of getPipeline9RouteCopperGeometry(route, input).viaSpans) {
      for (const pad of boardObstacles) {
        if (pad.shape !== "circle" || !pad.componentId) continue
        if (
          isPipeline9ObstacleConnectedToRoute({
            obstacle: pad,
            route,
            connMap: input.connMap,
          })
        ) {
          continue
        }
        const layers =
          pad.__zLayers ??
          pad.zLayers ??
          pad.layers.map((layer) => mapLayerNameToZ(layer, input.layerCount))
        if (!layers.some((z) => z >= via.minZ && z <= via.maxZ)) continue
        const circularGap =
          Math.hypot(via.center.x - pad.center.x, via.center.y - pad.center.y) -
          pad.width / 2 -
          via.diameter / 2
        if (!closest || circularGap < closest.circularGap) {
          closest = {
            pad,
            via,
            route,
            accepted,
            circularGap,
            rectangleGap:
              pointToBoxDistance(via.center, pad) - via.diameter / 2,
          }
        }
      }
    }
  }
  if (!closest) throw new Error("Missing DDR via beside a native BGA pad")
  return closest
}
