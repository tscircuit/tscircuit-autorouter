import { Pipeline9HighDensityForceImproveSolver } from "./Pipeline9HighDensityForceImproveSolver"
import { createPreloadedPortValidator } from "./createPreloadedPortValidator"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { Pipeline4HighDensityRepairSolver } from "../../solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { MultipleHighDensityRouteStitchSolver3 } from "../../solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { removeChangedSectionsFromFixedHdRoutes } from "./materializeHypergraphPreloadedTraceSections"
import { materializePipeline9HdRouteVias } from "./materializePipeline9HdRouteVias"
import { simplifyPipeline9CollinearRoutePoints } from "./simplifyPipeline9CollinearRoutePoints"
import { Pipeline9HighDensitySolver } from "./Pipeline9HighDensitySolver"
import { definePipeline9Step } from "./definePipeline9Step"
import {
  getOriginalFixedHdRoutes,
  getChangedPreloadedTraceSections,
} from "./pipeline9PreloadedTraceUpdates"

export const pipeline9HighDensitySteps = [
  definePipeline9Step({
    solverName: "uniformPortDistributionSolver",
    solverClass: UniformPortDistributionSolver,
    getConstructorParams: (pipeline) => [
      {
        nodeWithPortPoints:
          pipeline.portPointPathingSolver?.getOutput().nodesWithPortPoints ??
          [],
        inputNodesWithPortPoints:
          pipeline.portPointPathingSolver?.getOutput()
            .inputNodeWithPortPoints ?? [],
        minTraceWidth: pipeline.minTraceWidth,
        obstacles: pipeline.srj.obstacles,
        layerCount: pipeline.srj.layerCount,
        useLayerAwareGeometry: pipeline.srj.layerCount > 2,
        preserveSolitaryPorts: Boolean(pipeline.srj.traces?.length),
        isPortPointClear: createPreloadedPortValidator({
          srj: pipeline.srj,
          connMap: pipeline.connMap,
          traceWidth: pipeline.minTraceWidth,
          viaDiameter: pipeline.viaDiameter,
        }),
      },
    ],
  }),
  definePipeline9Step({
    solverName: "highDensityRouteSolver",
    solverClass: Pipeline9HighDensitySolver,
    getConstructorParams: (pipeline) => {
      const portPointPathingSolver = pipeline.portPointPathingSolver
      if (!portPointPathingSolver) {
        throw new Error(
          "Pipeline9 invariant violated: high-density routing requires the completed port-point pathing solver",
        )
      }
      const portPointPathingOutput = portPointPathingSolver.getOutput()
      const uniformNodes =
        pipeline.uniformPortDistributionSolver?.getOutput() ?? []
      const fallbackNodes = portPointPathingOutput.nodesWithPortPoints
      const nodePortPointsSource =
        uniformNodes.length > 0 ? uniformNodes : fallbackNodes

      pipeline.highDensityNodePortPoints = structuredClone(nodePortPointsSource)
      const originalFixedHdRoutes = getOriginalFixedHdRoutes(pipeline)
      const fixedHdRoutes = removeChangedSectionsFromFixedHdRoutes({
        traces: pipeline.originalSrj.traces ?? [],
        fixedHdRoutes: originalFixedHdRoutes,
        sections: getChangedPreloadedTraceSections(pipeline),
      })
      const hasImmutablePreloadedCopper = fixedHdRoutes.some(
        (route) => route.isFixed === true,
      )
      let obstacleMargin = pipeline.srj.defaultObstacleMargin ?? 0.15
      if (
        hasImmutablePreloadedCopper &&
        pipeline.srj.minTraceToPadEdgeClearance !== undefined
      ) {
        obstacleMargin = pipeline.srj.minTraceToPadEdgeClearance
      }

      return [
        {
          nodePortPoints: nodePortPointsSource,
          boardGeometry: {
            bounds: pipeline.originalSrj.bounds,
            outline: pipeline.originalSrj.outline,
            minBoardEdgeClearance: pipeline.originalSrj.minBoardEdgeClearance,
          },
          fixedHdRoutes,
          connMap: pipeline.connMap,
          colorMap: pipeline.colorMap,
          obstacles: pipeline.srj.obstacles,
          layerCount: pipeline.srj.layerCount,
          allowBlindAndBuriedVias: pipeline.srj.allowBlindAndBuriedVias,
          preserveNodeLayerConstraints: Boolean(
            pipeline.srj.viaKeepouts?.length,
          ),
          viaDiameter: pipeline.viaDiameter,
          viaHoleDiameter: pipeline.viaHoleDiameter,
          minViaHoleEdgeToViaHoleEdgeClearance:
            pipeline.originalSrj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
          traceWidth: pipeline.minTraceWidth,
          obstacleMargin,
          minClearance: pipeline.srj.minTraceToPadEdgeClearance,
          viaCopperClearance: pipeline.srj.minPadEdgeToPadEdgeClearance ?? 0.1,
          viaToPadClearance: pipeline.srj.minViaEdgeToPadEdgeClearance,
          effort: Math.min(1, pipeline.effort),
          includeBoardObstacles: true,
          nodePfById: portPointPathingSolver.computeNodePfMap(),
          preserveTerminalPcbPortIds: true,
        },
      ]
    },
  }),
  definePipeline9Step({
    solverName: "highDensityForceImproveSolver",
    solverClass: Pipeline9HighDensityForceImproveSolver,
    getConstructorParams: (pipeline) => [
      {
        inputSrj: pipeline.srj,
        nodeWithPortPoints: pipeline.highDensityNodePortPoints ?? [],
        fixedHdRoutes: pipeline
          .highDensityRouteSolver!.getUpdatedFixedHdRoutes()
          .filter((route) => route.isFixed === true),
        hdRoutes: simplifyPipeline9CollinearRoutePoints(
          materializePipeline9HdRouteVias(
            pipeline.highDensityRouteSolver!.routes,
          ),
        ),
        colorMap: pipeline.colorMap,
        totalStepsPerNode: Math.max(
          12,
          Math.round(20 * Math.min(1, pipeline.effort)),
        ),
        nodeAssignmentMargin: pipeline.srj.defaultObstacleMargin ?? 0.2,
        preserveTopologyPortAnchors: true,
      },
    ],
  }),
  definePipeline9Step({
    solverName: "highDensityRepairSolver",
    solverClass: Pipeline4HighDensityRepairSolver,
    getConstructorParams: (pipeline) => [
      {
        nodeWithPortPoints: pipeline.highDensityNodePortPoints ?? [],
        hdRoutes:
          pipeline.highDensityForceImproveSolver?.getOutput() ??
          pipeline.highDensityRouteSolver!.routes,
        obstacles: pipeline.srj.obstacles,
        colorMap: pipeline.colorMap,
        repairMargin: pipeline.srj.defaultObstacleMargin ?? 0.2,
        minimumTraceWidth: pipeline.srj.minTraceWidth,
        minClearance: pipeline.srj.minTraceToPadEdgeClearance,
        viaCopperClearance: pipeline.srj.minPadEdgeToPadEdgeClearance ?? 0.1,
        layerCount: pipeline.srj.layerCount,
        allowBlindAndBuriedVias: pipeline.srj.allowBlindAndBuriedVias,
        connMap: pipeline.connMap,
      },
    ],
  }),
  definePipeline9Step({
    solverName: "highDensityStitchSolver",
    solverClass: MultipleHighDensityRouteStitchSolver3,
    getConstructorParams: (pipeline) => [
      {
        connections: [
          ...pipeline.srjWithPointPairs!.connections,
          ...getChangedPreloadedTraceSections(pipeline).map(
            (section) => section.connection,
          ),
        ] as SimpleRouteConnection[],
        hdRoutes:
          pipeline.highDensityRepairSolver?.getOutput() ??
          pipeline.highDensityForceImproveSolver?.getOutput() ??
          pipeline.highDensityRouteSolver!.routes,
        otherHdRoutes: pipeline
          .highDensityRouteSolver!.getUpdatedFixedHdRoutes()
          .map(
            (route): HighDensityRoute => ({
              ...route,
              rootConnectionName:
                pipeline.originalSrj.traces![route.preloadedTraceIndex]!
                  .connection_name,
            }),
          ),
        minClearance:
          pipeline.srj.minTraceToPadEdgeClearance ??
          pipeline.srj.defaultObstacleMargin,
        colorMap: pipeline.colorMap,
        layerCount: pipeline.srj.layerCount,
        defaultViaDiameter: pipeline.viaDiameter,
        preserveTerminalPcbPortIds: true,
        preferSameLayerTerminalEndpoints: true,
      },
    ],
  }),
]
