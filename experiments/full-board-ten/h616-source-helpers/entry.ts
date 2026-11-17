export {
  getPipeline9FixedRouteObstacles,
  getPipeline9RouteCopperGeometry,
  doPipeline9RoutesHaveCopperConflict,
  arePipeline9RoutesOnSameNet,
} from "./lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
export { spliceFixedRouteSectionWithMutationMask } from "./lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
export { isPipeline9ObstacleConnectedToRoute } from "./lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
export { minimumDistanceBetweenSegments } from "./lib/utils/minimumDistanceBetweenSegments"
