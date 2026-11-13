import type { TraceWidthSolverInput } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "./AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"

type Params = {
  pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph
  hdRoutes: HighDensityRoute[]
  obstacleGeometry: "bounds" | "physical"
  refineExistingRoutes?: boolean
}

export const getPipeline9TraceWidthSolverInput = ({
  pipeline,
  hdRoutes,
  obstacleGeometry,
  refineExistingRoutes,
}: Params): TraceWidthSolverInput => {
  const pointPairs = pipeline.srjWithPointPairs
  if (!pointPairs) {
    throw new Error("Pipeline9 width selection requires point-pair connections")
  }
  let otherHdRoutes: HighDensityRoute[] | undefined
  if (refineExistingRoutes) {
    otherHdRoutes = pipeline.getUpdatedPreloadedTraces().flatMap(
      (trace, index): HighDensityRoute[] =>
        convertPreloadedTraceToHdRoutes(
          trace,
          index,
          pipeline.srj.layerCount,
          pipeline.viaDiameter,
          pipeline.connMap,
        ).map((route): HighDensityRoute => ({
          ...route,
          rootConnectionName: trace.connection_name,
        })),
    )
  }
  return {
    hdRoutes,
    obstacleGeometry,
    refineExistingRoutes,
    otherHdRoutes,
    obstacles: pipeline.srj.obstacles,
    connMap: pipeline.connMap,
    colorMap: pipeline.colorMap,
    minTraceWidth: pipeline.minTraceWidth,
    connection: pointPairs.connections,
    obstacleMargin: pipeline.srj.minTraceToPadEdgeClearance ?? 0.15,
    minTraceToHoleEdgeClearance: pipeline.srj.minTraceToHoleEdgeClearance,
    layerCount: pipeline.srj.layerCount,
  }
}
