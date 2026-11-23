import { getDifferentialPairsForPostProcessing } from "lib/utils/getDifferentialPairsForPostProcessing"
import { Pipeline9EffortCleanupSolver } from "./Pipeline9EffortCleanupSolver"
import { createPipeline9AutoroutingDrcEvaluator } from "./createPipeline9AutoroutingDrcEvaluator"
import {
  GlobalDrcForceImproveSolver,
  type GlobalDrcForceImproveSolverParams,
} from "high-density-repair03/lib"
import type { SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { NetToPointPairsSolver } from "../../solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { LengthMatchingPostProcessingSolver } from "../../solvers/length-matching-post-processing-solver"
import { assignUniquePcbTraceIdsToNewTraces } from "./assignUniquePcbTraceIdsToNewTraces"
import { getTerminalLayerIndicesByPcbPortId } from "./getTerminalLayerIndicesByPcbPortId"
import { canonicalizePipeline9HdRoutes } from "./canonicalizePipeline9HdRoutes"
import { convertPreloadedTraceToHdRoutes } from "./convertPreloadedTraceToHdRoutes"
import { Pipeline9JointDrcRepairSolver } from "./Pipeline9JointDrcRepairSolver"
import { PowerTraceExpansionSolver } from "../AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import { convertHdRoutesToSimplifiedPcbTraces } from "lib/utils/convertHdRoutesToSimplifiedPcbTraces"
import { getPowerTraceExpansionConnectionNames } from "../AutoroutingPipeline7_MultiGraph/getPowerTraceExpansionConnectionNames"
import { lockHdRouteTerminals } from "../AutoroutingPipeline7_MultiGraph/lock-hd-route-terminals"
import { preparePipeline7PowerTraceExpansionInput } from "../AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import type { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "./AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { definePipeline9Step } from "./definePipeline9Step"
import {
  getPreloadedTraceUpdatesAfterHighDensity,
  getSrjWithMaterializedPreloadedTraces,
} from "./pipeline9PreloadedTraceUpdates"

function getCleanupTraces(
  routes: HighDensityRoute[],
  pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
): SimplifiedPcbTraces {
  return assignUniquePcbTraceIdsToNewTraces(
    convertHdRoutesToSimplifiedPcbTraces({
      connections: pipeline.netToPointPairsSolver!.newConnections,
      originalConnections: pipeline.originalSrj.connections,
      hdRoutes: canonicalizePipeline9HdRoutes(routes),
      layerCount: pipeline.srj.layerCount,
      obstacles: pipeline.srj.obstacles,
      defaultViaHoleDiameter: pipeline.viaHoleDiameter,
      connMap: pipeline.connMap,
    }),
    pipeline.originalSrj.traces ?? [],
  )
}

export const pipeline9PostProcessingSteps = [
  definePipeline9Step({
    solverName: "globalDrcForceImproveSolver",
    solverClass: GlobalDrcForceImproveSolver,
    getConstructorParams: (pipeline) => {
      const srjWithMaterializedPreloadedTraces =
        getSrjWithMaterializedPreloadedTraces(pipeline)
      return [
        {
          // repair03’s SRJ declaration predates through_obstacle route points.
          srj: srjWithMaterializedPreloadedTraces as GlobalDrcForceImproveSolverParams["srj"],
          hdRoutes: lockHdRouteTerminals({
            hdRoutes: canonicalizePipeline9HdRoutes(
              pipeline.traceWidthSolver!.getHdRoutesWithWidths(),
            ),
            connections: pipeline.netToPointPairsSolver?.newConnections ?? [],
          }),
          connMap: pipeline.connMap,
          effort: Math.min(1, pipeline.effort),
          maxIterations: 16,
          enableLargeBoardBroadFallback: false,
          enablePostSolveClearanceRelaxation: false,
          deferTraceContactGuard: true,
        },
      ]
    },
  }),
  definePipeline9Step({
    solverName: "pipeline9JointDrcRepairSolver",
    solverClass: Pipeline9JointDrcRepairSolver,
    getConstructorParams: (pipeline) => {
      const preloadedTraceUpdates =
        getPreloadedTraceUpdatesAfterHighDensity(pipeline)
      const srjWithMaterializedPreloadedTraces =
        getSrjWithMaterializedPreloadedTraces(pipeline)
      return [
        {
          srj: srjWithMaterializedPreloadedTraces,
          srjWithPointPairs: srjWithMaterializedPreloadedTraces,
          originalSrj: pipeline.originalSrj,
          newConnections: pipeline.netToPointPairsSolver?.newConnections ?? [],
          newHdRoutes: pipeline.globalDrcForceImproveSolver!.getOutput(),
          originalNewHdRoutes:
            pipeline.globalDrcForceImproveSolver!.guardedInputHdRoutes,
          updatedPreloadedTraces: preloadedTraceUpdates.updatedPreloadedTraces,
          mutatedPreloadedTraceIds: new Set(
            preloadedTraceUpdates.mutatedPreloadedTraces.map(
              (trace) => trace.pcb_trace_id,
            ),
          ),
          connMap: pipeline.connMap,
          obstacles: pipeline.srj.obstacles,
          layerCount: pipeline.srj.layerCount,
          defaultViaDiameter: pipeline.viaDiameter,
          defaultViaHoleDiameter: pipeline.viaHoleDiameter,
          effort: Math.min(1, pipeline.effort),
          colorMap: pipeline.colorMap,
        },
      ]
    },
  }),
  definePipeline9Step({
    solverName: "effortCleanupSolver",
    solverClass: Pipeline9EffortCleanupSolver,
    getConstructorParams: (pipeline) => {
      const preloadedTraces = pipeline.getUpdatedPreloadedTraces()
      const otherHdRoutes = preloadedTraces.flatMap((trace, index) =>
        convertPreloadedTraceToHdRoutes(
          trace,
          index,
          pipeline.srj.layerCount,
          pipeline.viaDiameter,
          pipeline.connMap,
        ),
      )
      const inputSrj = { ...pipeline.originalSrj, traces: preloadedTraces }
      const hdRoutes = canonicalizePipeline9HdRoutes(
        pipeline.pipeline9JointDrcRepairSolver!.getOutput(),
      )
      const evaluateCleanupDrc = createPipeline9AutoroutingDrcEvaluator({
        inputSrj,
        srjWithPointPairs: pipeline.srjWithPointPairs!,
        includeBoardClearance: true,
        drcOptions: {
          traceClearance:
            pipeline.originalSrj.minTraceToPadEdgeClearance ??
            pipeline.originalSrj.defaultObstacleMargin ??
            0.1,
          viaClearance:
            pipeline.originalSrj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
        },
      })
      return [
        {
          effort: pipeline.effort,
          viaRemovalPasses:
            pipeline.pipeline9JointDrcRepairSolver!.stats
              .initialBoundedRegionalRepairAddedViaCount > 0
              ? 2
              : 1,
          config: {
            hdRoutes,
            preserveRouteEndpoints: true,
            obstacles: pipeline.srj.obstacles,
            connMap: pipeline.connMap,
            colorMap: pipeline.colorMap,
            outline: pipeline.srj.outline,
            defaultViaDiameter: pipeline.viaDiameter,
            layerCount: pipeline.srj.layerCount,
            minTraceToPadEdgeClearance: pipeline.srj.minTraceToPadEdgeClearance,
            minTraceToHoleEdgeClearance:
              pipeline.srj.minTraceToHoleEdgeClearance,
            minBoardEdgeClearance: pipeline.srj.minBoardEdgeClearance,
            otherHdRoutes,
            enableCrossingViaReduction: true,
            terminalLayerIndicesByPcbPortId: getTerminalLayerIndicesByPcbPortId(
              pipeline.srj.connections,
              pipeline.srj.obstacles,
              pipeline.srj.layerCount,
            ),
          },
          getCost: (
            routes: HighDensityRoute[],
          ): { vias: number; points: number } => {
            const traces = getCleanupTraces(routes, pipeline)
            return {
              vias: traces.reduce(
                (sum, trace) =>
                  sum +
                  trace.route.filter((point) => point.route_type === "via")
                    .length,
                0,
              ),
              points: traces.reduce(
                (sum, trace) => sum + trace.route.length,
                0,
              ),
            }
          },
          isValid: (routes: HighDensityRoute[]): boolean =>
            evaluateCleanupDrc(getCleanupTraces(routes, pipeline)).errors
              .length === 0,
          refineTraceWidths: (routes: HighDensityRoute[]): HighDensityRoute[] =>
            pipeline.traceWidthSolver!.refineWidths({
              hdRoutes: routes,
              otherHdRoutes: otherHdRoutes.map(
                (route): HighDensityRoute => ({
                  ...route,
                  rootConnectionName:
                    preloadedTraces[route.preloadedTraceIndex]!.connection_name,
                }),
              ),
            }),
        },
      ]
    },
  }),
  definePipeline9Step({
    solverName: "lengthMatchingPostProcessingSolver",
    solverClass: LengthMatchingPostProcessingSolver,
    getConstructorParams: (
      pipeline,
    ): ConstructorParameters<typeof LengthMatchingPostProcessingSolver> => {
      const netToPointPairsSolver = pipeline.netToPointPairsSolver
      if (!netToPointPairsSolver)
        throw new Error(
          "Pipeline9: length-matching post-processing requires NetToPointPairsSolver output",
        )
      const hdRoutes = pipeline.effortCleanupSolver!.getOutput()
      const { differentialPairs, differentialPairLanes } =
        getDifferentialPairsForPostProcessing({
          pipelineName: "Pipeline9",
          srj: pipeline.srj,
          pointPairConnections: netToPointPairsSolver.newConnections,
          pathHopsByConnectionName:
            netToPointPairsSolver.pathHopsByConnectionName,
          hdRoutes,
        })
      return [
        {
          hdRoutes,
          differentialPairs,
          differentialPairLanes,
          buses: pipeline.srj.buses ?? [],
          connections: [
            ...pipeline.srj.connections,
            ...netToPointPairsSolver.newConnections,
          ],
          obstacles: pipeline.srj.obstacles,
          traces: pipeline.getUpdatedPreloadedTraces(),
          bounds: pipeline.srj.bounds,
          layerCount: pipeline.srj.layerCount,
          obstacleMargin: pipeline.srj.minTraceToPadEdgeClearance ?? 0.15,
        },
      ]
    },
  }),
  definePipeline9Step({
    solverName: "powerTraceExpansionSolver",
    solverClass: PowerTraceExpansionSolver,
    getConstructorParams: (pipeline) => {
      const configuredOptions = pipeline.opts.powerTraceExpansion ?? {}
      const onlyConnectionNames =
        configuredOptions.onlyConnectionNames ??
        getPowerTraceExpansionConnectionNames(pipeline.originalSrj)
      return [
        preparePipeline7PowerTraceExpansionInput({
          originalSrj: pipeline.originalSrj,
          newlyRoutedTraces: pipeline.getNewTracesBeforePowerExpansion(),
          currentPreloadedTraces: pipeline.getUpdatedPreloadedTraces(),
          expandedConnectionNames: onlyConnectionNames,
          resolveConnectedTraceAliases: true,
        }),
        {
          allowNewVias: false,
          ...configuredOptions,
          onlyConnectionNames,
        },
      ]
    },
  }),
]
