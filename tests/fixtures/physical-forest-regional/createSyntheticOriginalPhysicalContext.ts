import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"

/** Explicit isolated electrical declarations for synthetic physical-world fixtures. */
export const createSyntheticOriginalPhysicalContext = (params: {
  connectionNames: string[]
  connMap: ConnectivityMap
  layerCount: number
  obstacles: Obstacle[]
}): {
  physicalOwnership: ReturnType<typeof getPipeline9PhysicalOwnership>
  physicalBoardObstacles: Obstacle[]
} => {
  const originalSrj: SimpleRouteJson = {
    layerCount: params.layerCount, minTraceWidth: 0.1,
    bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 },
    connections: params.connectionNames.map((name) => ({ name, pointsToConnect: [] })),
    obstacles: params.obstacles,
  }
  return {
    physicalOwnership: getPipeline9PhysicalOwnership({ originalSrj, routingConnMap: params.connMap }),
    physicalBoardObstacles: params.obstacles,
  }
}
