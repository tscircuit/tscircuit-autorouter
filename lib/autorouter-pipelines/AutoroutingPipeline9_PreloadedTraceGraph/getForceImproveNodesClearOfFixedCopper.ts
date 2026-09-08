import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { doRectsOverlap } from "lib/utils/doRectsOverlap"
import type { PreloadedHighDensityRoute } from "./convertPreloadedTraceToHdRoutes"
import { getPipeline9FixedRouteObstacles } from "./pipeline9FixedRouteCopper"

export const getForceImproveNodesClearOfFixedCopper = ({
  nodes,
  fixedRoutes,
  layerCount,
  clearance,
}: {
  nodes: NodeWithPortPoints[]
  fixedRoutes: PreloadedHighDensityRoute[]
  layerCount: number
  clearance: number
}): NodeWithPortPoints[] => {
  const obstacles = getPipeline9FixedRouteObstacles({
    fixedObstacleRoutes: fixedRoutes,
    layerCount,
  })
  return nodes.filter((node) => {
    const copperBounds = {
      center: node.center,
      width: node.width + 2 * clearance,
      height: node.height + 2 * clearance,
    }
    return !obstacles.some((obstacle) => doRectsOverlap(copperBounds, obstacle))
  })
}
