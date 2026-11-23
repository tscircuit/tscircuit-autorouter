import type { HighDensityRoute } from "lib/types/high-density-types"
import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { TraceWidthSolver } from "../../solvers/TraceWidthSolver/TraceWidthSolver"
import { getTerminalLayerIndicesByPcbPortId } from "./getTerminalLayerIndicesByPcbPortId"
import { getPipeline9NetByConnectionName } from "./getPipeline9NetByConnectionName"
import { canonicalizePipeline9HdRoutes } from "./canonicalizePipeline9HdRoutes"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"
import { definePipeline9Step } from "./definePipeline9Step"
import {
  getChangedPreloadedTraceSections,
  getPreparedMutatedPreloadedTraceSections,
  getPreloadedTraceUpdatesAfterHighDensity,
} from "./pipeline9PreloadedTraceUpdates"

export const pipeline9TraceRefinementSteps = [
  definePipeline9Step({
    solverName: "traceSimplificationSolver",
    solverClass: TraceSimplificationSolver,
    getConstructorParams: (pipeline) => {
      const preloadedHdRoutes = getPreloadedTraceUpdatesAfterHighDensity(
        pipeline,
      ).updatedPreloadedTraces.flatMap((trace, traceIndex) =>
        convertPreloadedTraceToHdRoutes(
          trace,
          traceIndex,
          pipeline.originalSrj.layerCount,
          pipeline.viaDiameter,
          pipeline.connMap,
        ).map((route) => ({
          ...route,
          // Simplification resolves IDs through connMap, not net keys.
          rootConnectionName: trace.connection_name,
        })),
      )
      const materializedConnectionNames = new Set<
        HighDensityRoute["connectionName"]
      >(
        getChangedPreloadedTraceSections(pipeline).map(
          (section) => section.connectionName,
        ),
      )
      // Via merging requires exactly co-located layer transitions.
      const newHdRoutes = canonicalizePipeline9HdRoutes(
        pipeline.highDensityStitchSolver!.mergedHdRoutes.filter(
          (route) => !materializedConnectionNames.has(route.connectionName),
        ),
      )
      const netByConnectionName = getPipeline9NetByConnectionName(
        [...newHdRoutes, ...preloadedHdRoutes],
        pipeline.connMap,
      )

      return [
        {
          hdRoutes: newHdRoutes,
          obstacles: pipeline.srj.obstacles,
          connMap: pipeline.connMap,
          colorMap: pipeline.colorMap,
          outline: pipeline.srj.outline,
          defaultViaDiameter: pipeline.viaDiameter,
          layerCount: pipeline.srj.layerCount,
          minTraceToPadEdgeClearance: pipeline.srj.minTraceToPadEdgeClearance,
          minTraceToHoleEdgeClearance: pipeline.srj.minTraceToHoleEdgeClearance,
          minBoardEdgeClearance: pipeline.srj.minBoardEdgeClearance,
          otherHdRoutes: preloadedHdRoutes,
          netByConnectionName,
          enableCrossingViaReduction: true,
          terminalLayerIndicesByPcbPortId: getTerminalLayerIndicesByPcbPortId(
            pipeline.srj.connections,
            pipeline.srj.obstacles,
            pipeline.srj.layerCount,
          ),
          iterations: 2,
        },
      ]
    },
  }),
  definePipeline9Step({
    solverName: "mutatedPreloadedTraceSimplificationSolver",
    solverClass: TraceSimplificationSolver,
    getConstructorParams: (pipeline) => {
      const preparedSections =
        getPreparedMutatedPreloadedTraceSections(pipeline)
      const editableHdRoutes = preparedSections.sections.map(
        (section) => section.hdRoute,
      )
      const otherHdRoutes = [
        ...preparedSections.immutableHdRoutes,
        ...pipeline.traceSimplificationSolver!.simplifiedHdRoutes,
      ]
      return [
        {
          hdRoutes: editableHdRoutes,
          obstacles: pipeline.srj.obstacles,
          connMap: pipeline.connMap,
          colorMap: pipeline.colorMap,
          outline: pipeline.srj.outline,
          defaultViaDiameter: pipeline.viaDiameter,
          layerCount: pipeline.srj.layerCount,
          minTraceToPadEdgeClearance: pipeline.srj.minTraceToPadEdgeClearance,
          minTraceToHoleEdgeClearance: pipeline.srj.minTraceToHoleEdgeClearance,
          minBoardEdgeClearance: pipeline.srj.minBoardEdgeClearance,
          otherHdRoutes,
          netByConnectionName: getPipeline9NetByConnectionName(
            [...editableHdRoutes, ...otherHdRoutes],
            pipeline.connMap,
          ),
          enableCrossingViaReduction: true,
          preserveRouteEndpoints: true,
          enableVertexShortcuts: true,
          iterations: 2,
        },
      ]
    },
  }),
  definePipeline9Step({
    solverName: "traceWidthSolver",
    solverClass: TraceWidthSolver,
    getConstructorParams: (pipeline) => [
      {
        hdRoutes: pipeline.traceSimplificationSolver!.simplifiedHdRoutes,
        obstacles: pipeline.srj.obstacles,
        connMap: pipeline.connMap,
        colorMap: pipeline.colorMap,
        minTraceWidth: pipeline.minTraceWidth,
        connection: pipeline.srjWithPointPairs!.connections,
        obstacleMargin: pipeline.srj.minTraceToPadEdgeClearance ?? 0.15,
        minTraceToHoleEdgeClearance: pipeline.srj.minTraceToHoleEdgeClearance,
        layerCount: pipeline.srj.layerCount,
      },
    ],
  }),
]
