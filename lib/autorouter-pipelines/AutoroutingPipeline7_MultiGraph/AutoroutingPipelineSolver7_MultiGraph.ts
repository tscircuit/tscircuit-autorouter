import { PostProcessingSolver as DifferentialPairPostProcessingSolver } from "@tscircuit/length-matching-solver"
import type { PowerTraceExpanderOptions } from "@tscircuit/power-trace-expander"
import { RectDiffPipeline } from "@tscircuit/rectdiff"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject, Line } from "graphics-debug"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import {
  GlobalDrcBranchPortfolioSolver,
  GlobalDrcForceImproveSolver,
} from "high-density-repair03/lib"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { CacheProvider } from "lib/cache/types"
import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { MultiGraphTopologyPlannerSolver } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { getColorMap } from "lib/solvers/colors"
import {
  CapacityMeshEdge,
  CapacityMeshNode,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTraces,
} from "lib/types"
import {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { applyNetColorsToGraphicsObject } from "lib/utils/applyNetColorsToGraphicsObject"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import {
  type TraceColorMode,
  convertSrjToGraphicsObject,
} from "lib/utils/convertSrjToGraphicsObject"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { createObstacleLabelFormatter } from "lib/utils/formatObstacleLabel"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import {
  getGraphicsLayerForConnectionPoint,
  getGraphicsLayerForObstacle,
} from "lib/utils/getGraphicsObjectLayer"
import { getPresuppliedTraceVisualization } from "lib/utils/getPresuppliedTraceVisualization"
import { calculateOptimalCapacityDepth } from "lib/utils/getTunedTotalCapacity1"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import {
  AvailableSegmentPointSolver,
  type SharedEdgeSegment,
} from "../../solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { BaseSolver } from "../../solvers/BaseSolver"
import { CapacityMeshEdgeSolver } from "../../solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "../../solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { CapacityNodeTargetMerger } from "../../solvers/CapacityNodeTargetMerger/CapacityNodeTargetMerger"
import { DeadEndSolver } from "../../solvers/DeadEndSolver/DeadEndSolver"
import { EscapeViaLocationSolver } from "../../solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import { Pipeline4HighDensityRepairSolver } from "../../solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { HighDensitySolver } from "../../solvers/HighDensitySolver/HighDensitySolver"
import { MultiSectionPortPointOptimizer } from "../../solvers/MultiSectionPortPointOptimizer"
import { NetToPointPairsSolver } from "../../solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { NetToPointPairsSolver2_OffBoardConnection } from "../../solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { MultipleHighDensityRouteStitchSolver3 } from "../../solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { SingleLayerNodeMergerSolver } from "../../solvers/SingleLayerNodeMerger/SingleLayerNodeMergerSolver"
import { StrawSolver } from "../../solvers/StrawSolver/StrawSolver"
import { TraceSimplificationSolver } from "../../solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { TraceWidthSolver } from "../../solvers/TraceWidthSolver/TraceWidthSolver"
import { PreprocessSimpleRouteJsonSolver } from "../AutoroutingPipeline4_TinyHypergraph/PreprocessSimpleRouteJsonSolver"
import { MergedComponentTopologyView } from "./MergedComponentTopologyView"
import { PowerTraceExpansionSolver } from "./PowerTraceExpansionSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "./convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { createPipeline7AutoroutingDrcEvaluator } from "./create-pipeline7-autorouting-drc-evaluator"
import { getPowerTraceExpansionConnectionNames } from "./getPowerTraceExpansionConnectionNames"
import { lockHdRouteTerminals } from "./lock-hd-route-terminals"
import { preparePipeline7PowerTraceExpansionInput } from "./prepare-pipeline7-power-trace-expansion-input"

interface CapacityMeshSolverOptions {
  capacityDepth?: number
  targetMinCapacity?: number
  cacheProvider?: CacheProvider | null
  effort?: number
  maxNodeDimension?: number
  maxNodeRatio?: number
  minNodeArea?: number
  visualizationTraceColorMode?: TraceColorMode
  powerTraceExpansion?: PowerTraceExpanderOptions
}
export type AutoroutingPipelineSolverOptions = CapacityMeshSolverOptions

type PipelineStep<T extends new (...args: any[]) => BaseSolver> = {
  solverName: string
  solverClass: T
  getConstructorParams: (
    instance: AutoroutingPipelineSolver7_MultiGraph,
  ) => ConstructorParameters<T>
  onSolved?: (instance: AutoroutingPipelineSolver7_MultiGraph) => void
}

/**
 * Collects the capacity mesh node ids produced by component-local topology
 * generation.
 *
 * @param capacityMeshNodes Capacity mesh nodes after topology merging and subdivision.
 * @returns A set of component-local capacity mesh node ids.
 */
function getComponentCapacityMeshNodeIds(
  capacityMeshNodes: CapacityMeshNode[] | null | undefined,
) {
  return new Set(
    (capacityMeshNodes ?? [])
      .filter((node) => node._isComponentTopologyNode)
      .map((node) => node.capacityMeshNodeId),
  )
}

/**
 * Checks whether a shared edge segment touches a component-local mesh node.
 *
 * @param segment Shared edge segment produced by AvailableSegmentPointSolver.
 * @param componentCapacityMeshNodeIds Component-local capacity mesh node ids.
 * @returns True when either node on the segment belongs to a component region.
 */
function isComponentSharedEdgeSegment(
  segment: SharedEdgeSegment,
  componentCapacityMeshNodeIds: Set<string>,
) {
  return segment.nodeIds.some((nodeId) =>
    componentCapacityMeshNodeIds.has(nodeId),
  )
}

/**
 * Removes component-region shared edge segments before running the necessary
 * cramped port point solver.
 *
 * @param params.sharedEdgeSegments Candidate shared edge segments.
 * @param params.componentCapacityMeshNodeIds Component-local capacity mesh node ids.
 * @returns Shared edge segments that do not touch component-local mesh nodes.
 */
function getNonComponentSharedEdgeSegments({
  sharedEdgeSegments,
  componentCapacityMeshNodeIds,
}: {
  sharedEdgeSegments: SharedEdgeSegment[]
  componentCapacityMeshNodeIds: Set<string>
}) {
  return sharedEdgeSegments.filter(
    (segment) =>
      !isComponentSharedEdgeSegment(segment, componentCapacityMeshNodeIds),
  )
}

/**
 * Restores untouched component-region segments after the necessary cramped port
 * point solver filters the non-component mesh.
 *
 * @param params.originalSharedEdgeSegments Original shared edge segments from AvailableSegmentPointSolver.
 * @param params.filteredSharedEdgeSegments Solver-filtered shared edge segments for non-component regions.
 * @param params.componentCapacityMeshNodeIds Component-local capacity mesh node ids.
 * @returns Shared edge segments where component regions are untouched and other regions use solver output.
 */
function mergeComponentSharedEdgeSegments({
  originalSharedEdgeSegments,
  filteredSharedEdgeSegments,
  componentCapacityMeshNodeIds,
}: {
  originalSharedEdgeSegments: SharedEdgeSegment[]
  filteredSharedEdgeSegments: SharedEdgeSegment[]
  componentCapacityMeshNodeIds: Set<string>
}) {
  const filteredSegmentsByEdgeId = new Map(
    filteredSharedEdgeSegments.map((segment) => [segment.edgeId, segment]),
  )

  return originalSharedEdgeSegments.map((segment) => {
    // Component-local cramped points are intentionally preserved even if they
    // would otherwise be filtered by the necessary cramped port point solver.
    if (isComponentSharedEdgeSegment(segment, componentCapacityMeshNodeIds)) {
      return segment
    }

    return filteredSegmentsByEdgeId.get(segment.edgeId) ?? segment
  })
}

function definePipelineStep<
  T extends new (
    ...args: any[]
  ) => BaseSolver,
  const P extends ConstructorParameters<T>,
>(
  solverName: keyof AutoroutingPipelineSolver7_MultiGraph,
  solverClass: T,
  getConstructorParams: (instance: AutoroutingPipelineSolver7_MultiGraph) => P,
  opts: {
    onSolved?: (instance: AutoroutingPipelineSolver7_MultiGraph) => void
  } = {},
): PipelineStep<T> {
  return {
    solverName,
    solverClass,
    getConstructorParams,
    onSolved: opts.onSolved,
  }
}

export class AutoroutingPipelineSolver7_MultiGraph extends BaseSolver {
  override getSolverName(): string {
    return "AutoroutingPipelineSolver7_MultiGraph"
  }

  preprocessSimpleRouteJsonSolver?: PreprocessSimpleRouteJsonSolver
  escapeViaLocationSolver?: EscapeViaLocationSolver
  netToPointPairsSolver?: NetToPointPairsSolver
  componentTopologyGeneratorSolver?: MergedComponentTopologyView
  topologyPlanningSolver?: MultiGraphTopologyPlannerSolver
  topologyMergingSolver?: TopologyMergingSolver
  globalTopologyGeneratorSolver?: RectDiffPipeline
  nodeDimensionSubdivisionSolver?: NodeDimensionSubdivisionSolver
  nodeTargetMerger?: CapacityNodeTargetMerger
  edgeSolver?: CapacityMeshEdgeSolver
  colorMap!: Record<string, string>
  highDensityRouteSolver?: HighDensitySolver
  highDensityForceImproveSolver?: HighDensityForceImproveSolver
  highDensityRepairSolver?: Pipeline4HighDensityRepairSolver
  highDensityStitchSolver?: MultipleHighDensityRouteStitchSolver3
  globalDrcForceImproveSolver?: GlobalDrcForceImproveSolver
  exactGeometryDrcForceImproveSolver?: GlobalDrcBranchPortfolioSolver
  singleLayerNodeMerger?: SingleLayerNodeMergerSolver
  strawSolver?: StrawSolver
  deadEndSolver?: DeadEndSolver
  traceSimplificationSolver?: TraceSimplificationSolver
  lengthMatchingPostProcessingSolver?: DifferentialPairPostProcessingSolver
  powerTraceExpansionSolver?: PowerTraceExpansionSolver
  availableSegmentPointSolver?: AvailableSegmentPointSolver
  portPointPathingSolver?: TinyHypergraphPortPointPathingSolver
  multiSectionPortPointOptimizer?: MultiSectionPortPointOptimizer
  uniformPortDistributionSolver?: UniformPortDistributionSolver
  traceWidthSolver?: TraceWidthSolver
  necessaryCrampedPortPointSolver?: MultiTargetNecessaryCrampedPortPointSolver
  componentDetectionSolver?: ComponentDetectionSolver
  viaDiameter!: number
  viaHoleDiameter!: number
  minTraceWidth!: number
  effort: number
  maxNodeDimension: number
  maxNodeRatio: number
  minNodeArea: number
  visualizationTraceColorMode: TraceColorMode

  startTimeOfPhase: Record<string, number>
  endTimeOfPhase: Record<string, number>
  timeSpentOnPhase: Record<string, number>

  activeSubSolver?: BaseSolver | null = null
  connMap!: ConnectivityMap
  srjWithEscapeViaLocations?: SimpleRouteJson
  srjWithPointPairs?: SimpleRouteJson
  originalSrj: SimpleRouteJson
  capacityNodes: CapacityMeshNode[] | null = null
  capacityEdges: CapacityMeshEdge[] | null = null
  /** Available segment points after non-component cramped points are filtered. */
  sharedEdgeSegmentsWithNecessaryCrampedPortPoints?: SharedEdgeSegment[]
  highDensityNodePortPoints?: NodeWithPortPoints[]

  cacheProvider: CacheProvider | null = null
  pipelineDef = [
    definePipelineStep(
      "preprocessSimpleRouteJsonSolver",
      PreprocessSimpleRouteJsonSolver,
      (cms) => [
        cms.originalSrj,
        { traceColorMode: cms.visualizationTraceColorMode },
      ],
      {
        onSolved: (cms) => {
          cms.setSimpleRouteJson(
            cms.preprocessSimpleRouteJsonSolver!.getOutputSimpleRouteJson(),
          )
        },
      },
    ),
    definePipelineStep(
      "componentDetectionSolver",
      ComponentDetectionSolver,
      (cms) => [{ inputSrj: cms.srj }],
    ),
    definePipelineStep(
      "escapeViaLocationSolver",
      EscapeViaLocationSolver,
      (cms) => [
        cms.srj,
        {
          viaDiameter: cms.viaDiameter,
          minTraceWidth: cms.minTraceWidth,
          obstacleMargin: cms.srj.defaultObstacleMargin ?? 0.15,
        },
      ],
      {
        onSolved: (cms) => {
          cms.srjWithEscapeViaLocations =
            cms.escapeViaLocationSolver?.getOutputSimpleRouteJson()
        },
      },
    ),
    definePipelineStep(
      "netToPointPairsSolver",
      NetToPointPairsSolver2_OffBoardConnection,
      (cms) => {
        const inputSrj = cms.srjWithEscapeViaLocations ?? cms.srj
        return [
          inputSrj,
          cms.colorMap,
          getInitiallyConnectedMapFromSimpleRouteJson(inputSrj),
        ]
      },
      {
        onSolved: (cms) => {
          cms.srjWithPointPairs =
            cms.netToPointPairsSolver?.getNewSimpleRouteJson()
          cms.colorMap = getColorMap(cms.srjWithPointPairs!, cms.connMap)
          cms.connMap = getConnectivityMapFromSimpleRouteJson(
            cms.srjWithPointPairs!,
          )
        },
      },
    ),
    definePipelineStep(
      "topologyPlanningSolver",
      MultiGraphTopologyPlannerSolver,
      (cms) => [
        {
          inputSrj: cms.srjWithPointPairs!,
          componentDetectionOutput: cms.componentDetectionSolver!.getOutput(),
          viaDiameter: cms.viaDiameter,
          obstacleMargin: cms.srj.defaultObstacleMargin ?? 0.15,
        },
      ],
      {
        onSolved: (cms) => {
          const output = cms.topologyPlanningSolver!.getOutput()

          cms.globalTopologyGeneratorSolver =
            cms.topologyPlanningSolver!.globalTopologySolver
          cms.componentTopologyGeneratorSolver =
            new MergedComponentTopologyView(cms.topologyPlanningSolver!)
        },
      },
    ),
    definePipelineStep(
      "topologyMergingSolver",
      TopologyMergingSolver,
      (cms) => {
        const topologyOutput = cms.topologyPlanningSolver!.getOutput()

        return [
          {
            layerCount: cms.srj.layerCount,
            nodeGroups: [
              {
                groupId: "global",
                nodes: topologyOutput.globalMeshNodes,
                isComponent: false,
              },
              ...topologyOutput.componentMeshNodes.map((nodes, index) => ({
                groupId: `component-${index}`,
                nodes,
                isComponent: true,
              })),
            ],
          },
        ]
      },
      {
        onSolved: (cms) => {
          cms.capacityNodes = cms.topologyMergingSolver!.getOutput()
        },
      },
    ),
    definePipelineStep(
      "nodeDimensionSubdivisionSolver",
      NodeDimensionSubdivisionSolver,
      (cms) => [
        cms.capacityNodes!,
        cms.maxNodeDimension,
        cms.maxNodeRatio,
        cms.minNodeArea,
      ],
      {
        onSolved: (cms) => {
          cms.capacityNodes = cms.nodeDimensionSubdivisionSolver!.outputNodes
        },
      },
    ),
    definePipelineStep(
      "edgeSolver",
      CapacityMeshEdgeSolver2_NodeTreeOptimization,
      (cms) => [cms.capacityNodes!],
      {
        onSolved: (cms) => {
          cms.capacityEdges = cms.edgeSolver?.edges!
        },
      },
    ),
    definePipelineStep(
      "availableSegmentPointSolver",
      AvailableSegmentPointSolver,
      (cms) => [
        {
          nodes: cms.capacityNodes!,
          edges: cms.capacityEdges || [],
          traceWidth: cms.minTraceWidth,
          colorMap: cms.colorMap,
          shouldReturnCrampedPortPoints: true,
        },
      ],
    ),
    definePipelineStep(
      "necessaryCrampedPortPointSolver",
      MultiTargetNecessaryCrampedPortPointSolver,
      (cms) => {
        const componentCapacityMeshNodeIds = getComponentCapacityMeshNodeIds(
          cms.capacityNodes,
        )

        return [
          {
            capacityMeshNodes: cms.capacityNodes!.filter(
              (node) =>
                !componentCapacityMeshNodeIds.has(node.capacityMeshNodeId),
            ),
            // Do not let the cramped-port solver remove component-local port
            // points. Those regions are generated by the topology planner and
            // remain valid even when the generated port points are cramped.
            sharedEdgeSegments: getNonComponentSharedEdgeSegments({
              sharedEdgeSegments: cms.availableSegmentPointSolver!.getOutput(),
              componentCapacityMeshNodeIds,
            }),
            simpleRouteJson: cms.srjWithPointPairs!,
          },
        ]
      },
      {
        onSolved: (cms) => {
          const componentCapacityMeshNodeIds = getComponentCapacityMeshNodeIds(
            cms.capacityNodes,
          )

          cms.sharedEdgeSegmentsWithNecessaryCrampedPortPoints =
            mergeComponentSharedEdgeSegments({
              originalSharedEdgeSegments:
                cms.availableSegmentPointSolver!.getOutput(),
              filteredSharedEdgeSegments:
                cms.necessaryCrampedPortPointSolver!.getOutput(),
              componentCapacityMeshNodeIds,
            })
        },
      },
    ),
    definePipelineStep(
      "portPointPathingSolver",
      TinyHypergraphPortPointPathingSolver,
      (cms) => {
        const sharedEdgeSegments =
          cms.sharedEdgeSegmentsWithNecessaryCrampedPortPoints ??
          cms.necessaryCrampedPortPointSolver?.getOutput() ??
          cms.availableSegmentPointSolver!.getOutput()
        const { graph, connections } = buildHyperGraph({
          capacityMeshNodes: cms.capacityNodes!,
          layerCount: cms.srj.layerCount,
          connectivityMap: cms.connMap,
          segmentPortPoints: sharedEdgeSegments.flatMap(
            (seg) => seg.portPoints,
          ),
          simpleRouteJsonConnections: cms.srjWithPointPairs!.connections,
        })

        return [
          {
            graph,
            connections,
            layerCount: cms.srj.layerCount,
            effort: cms.effort,
            preserveTerminalPcbPortIds: true,
            minViaPadDiameter: cms.viaDiameter,
            flags: {
              FORCE_CENTER_FIRST: true,
              RIPPING_ENABLED: true,
              USE_SELECTIVE_RERIP_ROUTING: true,
            },
            weights: {
              SHUFFLE_SEED: 0,
              MEMORY_PF_FACTOR: 4,
              CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
              CENTER_OFFSET_FOCUS_SHIFT: 0,
              NODE_PF_FACTOR: 0,
              LAYER_CHANGE_COST: 0,
              RIPPING_PF_COST: 0.0,
              NODE_PF_MAX_PENALTY: 100,
              BASE_CANDIDATE_COST: 0.6,
              MAX_ITERATIONS_PER_PATH: 0,
              RANDOM_WALK_DISTANCE: 0,
              START_RIPPING_PF_THRESHOLD: 0.3,
              END_RIPPING_PF_THRESHOLD: 1,
              MAX_RIPS: 1000,
              RANDOM_RIP_FRACTION: 0.3,
              STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 4,
              GREEDY_MULTIPLIER: 0.7,
              MIN_ALLOWED_BOARD_SCORE: -10000,
            },
          },
        ]
      },
    ),
    definePipelineStep(
      "uniformPortDistributionSolver",
      UniformPortDistributionSolver,
      (cms) => [
        {
          nodeWithPortPoints:
            cms.portPointPathingSolver?.getOutput().nodesWithPortPoints ?? [],
          inputNodesWithPortPoints:
            cms.portPointPathingSolver?.getOutput().inputNodeWithPortPoints ??
            [],
          minTraceWidth: cms.minTraceWidth,
          obstacles: cms.srj.obstacles,
          layerCount: cms.srj.layerCount,
        },
      ],
    ),
    definePipelineStep("highDensityRouteSolver", HighDensitySolver, (cms) => {
      const uniformNodes = cms.uniformPortDistributionSolver?.getOutput() ?? []
      const fallbackNodes =
        cms.portPointPathingSolver?.getOutput().nodesWithPortPoints ?? []
      const nodePortPointsSource =
        uniformNodes.length > 0 ? uniformNodes : fallbackNodes
      const highDensityNodeIds = new Set(
        nodePortPointsSource.map((node) => node.capacityMeshNodeId),
      )

      cms.highDensityNodePortPoints = structuredClone(nodePortPointsSource)

      return [
        {
          nodePortPoints: nodePortPointsSource,
          nodePfById: new Map(
            (
              cms.portPointPathingSolver?.getOutput().inputNodeWithPortPoints ??
              []
            )
              .filter((node) =>
                highDensityNodeIds.has(node.capacityMeshNodeId),
              )
              .map((node) => [
                node.capacityMeshNodeId,
                cms.portPointPathingSolver?.computeNodePf(node) ?? null,
              ]),
          ),
          colorMap: cms.colorMap,
          connMap: cms.connMap,
          viaDiameter: cms.viaDiameter,
          traceWidth: cms.minTraceWidth,
          obstacleMargin: cms.srj.defaultObstacleMargin ?? 0.15,
          obstacles: cms.srj.obstacles,
          layerCount: cms.srj.layerCount,
          useGrowShrinkHighDensityIntraNodeSolver: true,
          preserveTerminalPcbPortIds: true,
          growShrinkFallbackToInvalidGeometryOnFailure: true,
          captureSearchDebug: false,
        },
      ]
    }),
    definePipelineStep(
      "highDensityForceImproveSolver",
      HighDensityForceImproveSolver,
      (cms) => [
        {
          nodeWithPortPoints: cms.highDensityNodePortPoints ?? [],
          hdRoutes: cms.highDensityRouteSolver!.routes,
          colorMap: cms.colorMap,
          totalStepsPerNode: Math.max(12, Math.round(20 * cms.effort)),
          nodeAssignmentMargin: cms.srj.defaultObstacleMargin ?? 0.2,
        },
      ],
    ),
    definePipelineStep(
      "highDensityRepairSolver",
      Pipeline4HighDensityRepairSolver,
      (cms) => [
        {
          nodeWithPortPoints: cms.highDensityNodePortPoints ?? [],
          hdRoutes:
            cms.highDensityForceImproveSolver?.getOutput() ??
            cms.highDensityRouteSolver!.routes,
          obstacles: cms.srj.obstacles,
          colorMap: cms.colorMap,
          repairMargin: cms.srj.defaultObstacleMargin ?? 0.2,
          maxSampleEntries: 80,
        },
      ],
    ),
    definePipelineStep(
      "highDensityStitchSolver",
      MultipleHighDensityRouteStitchSolver3,
      (cms) => [
        {
          connections: cms.srjWithPointPairs!.connections,
          hdRoutes:
            cms.highDensityRepairSolver?.getOutput() ??
            cms.highDensityForceImproveSolver?.getOutput() ??
            cms.highDensityRouteSolver!.routes,
          colorMap: cms.colorMap,
          layerCount: cms.srj.layerCount,
          defaultViaDiameter: cms.viaDiameter,
          preserveTerminalPcbPortIds: true,
        },
      ],
    ),
    definePipelineStep(
      "traceSimplificationSolver",
      TraceSimplificationSolver,
      (cms) => [
        {
          hdRoutes: cms.highDensityStitchSolver!.mergedHdRoutes,
          obstacles: cms.srj.obstacles,
          connMap: cms.connMap,
          colorMap: cms.colorMap,
          outline: cms.srj.outline,
          defaultViaDiameter: cms.viaDiameter,
          layerCount: cms.srj.layerCount,
          minTraceToPadEdgeClearance: cms.srj.minTraceToPadEdgeClearance,
          minBoardEdgeClearance: cms.srj.minBoardEdgeClearance,
          enableCrossingViaReduction: true,
          iterations: 2,
        },
      ],
    ),
    definePipelineStep("traceWidthSolver", TraceWidthSolver, (cms) => [
      {
        hdRoutes: cms.traceSimplificationSolver!.simplifiedHdRoutes,
        obstacles: cms.srj.obstacles,
        connMap: cms.connMap,
        colorMap: cms.colorMap,
        minTraceWidth: cms.minTraceWidth,
        connection: cms.srj.connections,
        obstacleMargin: cms.srj.minTraceToPadEdgeClearance ?? 0.15,
        layerCount: cms.srj.layerCount,
      },
    ]),
    definePipelineStep(
      "globalDrcForceImproveSolver",
      GlobalDrcForceImproveSolver,
      (cms) => [
        {
          srj: cms.srjWithPointPairs! as any,
          hdRoutes: lockHdRouteTerminals(
            cms.traceWidthSolver!.getHdRoutesWithWidths(),
            cms.netToPointPairsSolver?.newConnections ?? [],
            new Map(
              (cms.highDensityStitchSolver?.mergedHdRoutes ?? []).map(
                (route) => [route.connectionName, route],
              ),
            ),
          ),
          connMap: cms.connMap,
          effort: cms.effort,
          maxIterations: 16,
          enableLargeBoardBroadFallback: false,
          enablePostSolveClearanceRelaxation: false,
        },
      ],
    ),
    definePipelineStep(
      "exactGeometryDrcForceImproveSolver",
      GlobalDrcBranchPortfolioSolver,
      (cms) => {
        const hdRoutes = cms.globalDrcForceImproveSolver!.getOutput()
        const autoroutingDrcEvaluator = createPipeline7AutoroutingDrcEvaluator({
          connections: cms.netToPointPairsSolver?.newConnections ?? [],
          originalConnections: cms.originalSrj.connections,
          layerCount: cms.srj.layerCount,
          obstacles: cms.srj.obstacles,
          defaultViaHoleDiameter: cms.viaHoleDiameter,
          connMap: cms.connMap,
          srjWithPointPairs: cms.srjWithPointPairs!,
          originalSrj: cms.originalSrj,
        })

        return [
          {
            srj: cms.srjWithPointPairs! as any,
            hdRoutes,
            connMap: cms.connMap,
            effort: cms.effort,
            viaHoleDiameter: cms.viaHoleDiameter,
            drcEvaluator: autoroutingDrcEvaluator,
            viaInPadDrcEvaluator: autoroutingDrcEvaluator,
            maxIterations: 32,
            enableLargeBoardBroadFallback: false,
            enableBroadFallback: false,
            enableTargetedErrorSweep: true,
            enablePostSolveClearanceRelaxation: false,
            enableSafeTraceLayerMoves: true,
            enableViaInPadLayerMoves: cms.originalSrj.allowViaInPad ?? false,
            viaInPadMaxIterations: 32,
            broadMaxIterations: 12,
            broadPassMultiplier: 3,
          },
        ]
      },
    ),
    definePipelineStep(
      "lengthMatchingPostProcessingSolver",
      DifferentialPairPostProcessingSolver,
      (cms) => {
        const netToPointPairsSolver = cms.netToPointPairsSolver
        if (!netToPointPairsSolver)
          throw new Error(
            "Pipeline7: length-matching post-processing requires NetToPointPairsSolver output",
          )
        const connections = netToPointPairsSolver.newConnections
        const finalHdConnectionNames = new Map<string, string>()
        for (const pair of cms.srj.differentialPairs ?? []) {
          for (const connectionName of pair.connectionNames) {
            const matchingConnections = connections.filter(
              (connection) =>
                connection.name === connectionName ||
                connection.__rootConnectionNames?.includes(connectionName) ||
                connection.__netConnectionName === connectionName,
            )
            if (matchingConnections.length !== 1)
              throw new Error(
                `Pipeline7: differential pair connection "${connectionName}" must resolve to exactly one final point-pair connection, got ${matchingConnections.length}`,
              )
            finalHdConnectionNames.set(
              connectionName,
              matchingConnections[0]!.name,
            )
          }
        }
        const hdRoutes = cms.exactGeometryDrcForceImproveSolver!.getOutput()
        const differentialPairs = (cms.srj.differentialPairs ?? []).map(
          (pair) => {
            const connectionNames = pair.connectionNames.map(
              (connectionName) => {
                const finalHdConnectionName =
                  finalHdConnectionNames.get(connectionName)
                if (!finalHdConnectionName)
                  throw new Error(
                    `Pipeline7: differential pair connection "${connectionName}" is missing from final routed output`,
                  )
                return finalHdConnectionName
              },
            ) as [string, string]
            if (connectionNames[0] === connectionNames[1])
              throw new Error(
                `Pipeline7: differential pair ${pair.connectionNames.join("/")} resolves both members to "${connectionNames[0]}"`,
              )
            if (pair.traceGap === undefined)
              return {
                connectionNames,
                lengthTolerance: pair.lengthTolerance,
                maxUncoupledLength: pair.maxUncoupledLength,
              }
            const pairRoutes = connectionNames.map((connectionName) => {
              const matchingRoutes = hdRoutes.filter(
                (route) => route.connectionName === connectionName,
              )
              if (matchingRoutes.length !== 1)
                throw new Error(
                  `Pipeline7: differential pair connection "${connectionName}" must resolve to exactly one final HD route, got ${matchingRoutes.length}`,
                )
              return matchingRoutes[0]!
            })
            const centerlineDistance =
              pair.traceGap +
              pairRoutes.reduce(
                (halfWidthTotal, route) =>
                  halfWidthTotal + route.traceThickness / 2,
                0,
              )
            return {
              connectionNames,
              lengthTolerance: pair.lengthTolerance,
              maxUncoupledLength: pair.maxUncoupledLength,
              minimumCenterlineDistance: centerlineDistance,
              maximumCenterlineDistance: centerlineDistance,
            }
          },
        )
        return [
          {
            hdRoutes,
            differentialPairs,
            obstacles: cms.srj.obstacles,
            bounds: cms.srj.bounds,
            layerCount: cms.srj.layerCount,
          },
        ]
      },
    ),
    definePipelineStep(
      "powerTraceExpansionSolver",
      PowerTraceExpansionSolver,
      (cms) => {
        const configuredOptions = cms.opts.powerTraceExpansion ?? {}
        const onlyConnectionNames =
          configuredOptions.onlyConnectionNames ??
          getPowerTraceExpansionConnectionNames(cms.originalSrj)
        return [
          preparePipeline7PowerTraceExpansionInput({
            originalSrj: cms.originalSrj,
            newlyRoutedTraces: cms.getPrePowerTraceOutputSimplifiedPcbTraces(),
            expandedConnectionNames: onlyConnectionNames,
          }),
          {
            allowNewVias: false,
            ...configuredOptions,
            onlyConnectionNames,
          },
        ]
      },
    ),
  ]

  constructor(
    public srj: SimpleRouteJson,
    public readonly opts: CapacityMeshSolverOptions = {},
  ) {
    super()
    const srjWithBoardValidObstacleLayers =
      createSrjWithBoardValidObstacleLayers(srj)
    this.originalSrj = srjWithBoardValidObstacleLayers
    this.opts = { ...opts }
    const mutableOpts = this.opts
    this.effort = mutableOpts.effort ?? 1
    // scale with effort so the outer cap never decapitates inner solvers
    this.MAX_ITERATIONS = 100e6 * this.effort
    this.maxNodeDimension = mutableOpts.maxNodeDimension ?? 16
    this.maxNodeRatio = mutableOpts.maxNodeRatio ?? 6
    this.minNodeArea = mutableOpts.minNodeArea ?? 0.1 ** 2
    this.visualizationTraceColorMode =
      mutableOpts.visualizationTraceColorMode ?? "layer"
    this.setSimpleRouteJson(srjWithBoardValidObstacleLayers)

    if (mutableOpts.capacityDepth === undefined) {
      const boundsWidth = this.srj.bounds.maxX - this.srj.bounds.minX
      const boundsHeight = this.srj.bounds.maxY - this.srj.bounds.minY
      const maxWidthHeight = Math.max(boundsWidth, boundsHeight)
      const targetMinCapacity = mutableOpts.targetMinCapacity ?? 0.5
      mutableOpts.capacityDepth = calculateOptimalCapacityDepth(
        maxWidthHeight,
        targetMinCapacity,
      )
    }

    this.cacheProvider =
      mutableOpts.cacheProvider === undefined
        ? getGlobalInMemoryCache()
        : mutableOpts.cacheProvider === null
          ? null
          : mutableOpts.cacheProvider
    this.startTimeOfPhase = {}
    this.endTimeOfPhase = {}
    this.timeSpentOnPhase = {}
  }

  private setSimpleRouteJson(srj: SimpleRouteJson) {
    this.srj = srj
    const viaDimensions = getViaDimensions(this.srj)
    this.viaDiameter = viaDimensions.padDiameter
    this.viaHoleDiameter = viaDimensions.holeDiameter
    this.minTraceWidth = this.srj.minTraceWidth
    this.connMap = getConnectivityMapFromSimpleRouteJson(this.srj)
    this.colorMap = getColorMap(this.srj, this.connMap)
  }

  getConstructorParams() {
    return [this.srj, this.opts] as const
  }

  currentPipelineStepIndex = 0
  _step() {
    const pipelineStepDef = this.pipelineDef[this.currentPipelineStepIndex]
    if (!pipelineStepDef) {
      this.solved = true
      return
    }

    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      if (this.activeSubSolver.solved) {
        this.endTimeOfPhase[pipelineStepDef.solverName] = performance.now()
        this.timeSpentOnPhase[pipelineStepDef.solverName] =
          this.endTimeOfPhase[pipelineStepDef.solverName] -
          this.startTimeOfPhase[pipelineStepDef.solverName]
        pipelineStepDef.onSolved?.(this)
        this.activeSubSolver = null
        this.currentPipelineStepIndex++
      } else if (this.activeSubSolver.failed) {
        this.error = this.activeSubSolver?.error
        this.failed = true
        this.activeSubSolver = null
      }
      return
    }

    const constructorParams = pipelineStepDef.getConstructorParams(this)
    // @ts-ignore
    this.activeSubSolver = new pipelineStepDef.solverClass(...constructorParams)
    if (
      pipelineStepDef.solverName === "lengthMatchingPostProcessingSolver" ||
      pipelineStepDef.solverName === "powerTraceExpansionSolver"
    )
      this.MAX_ITERATIONS = Math.max(
        this.MAX_ITERATIONS,
        this.iterations + this.activeSubSolver.MAX_ITERATIONS + 1,
      )
    ;(this as any)[pipelineStepDef.solverName] = this.activeSubSolver
    this.timeSpentOnPhase[pipelineStepDef.solverName] = 0
    this.startTimeOfPhase[pipelineStepDef.solverName] = performance.now()
  }

  solveUntilPhase(phase: string) {
    while (this.getCurrentPhase() !== phase) {
      this.step()
    }
  }

  getCurrentPhase(): string {
    return this.pipelineDef[this.currentPipelineStepIndex]?.solverName ?? "none"
  }

  visualize(): GraphicsObject {
    if (!this.solved && this.activeSubSolver) {
      return this.visualizeStage(this.activeSubSolver)
    }
    const escapeViaLocationViz = this.escapeViaLocationSolver?.visualize()
    const netToPPSolver = this.netToPointPairsSolver?.visualize()
    const componentDetectionViz = this.componentDetectionSolver?.visualize()
    const componentTopologyGeneratorViz =
      this.componentTopologyGeneratorSolver?.visualize()
    const globalTopologyGeneratorViz =
      this.globalTopologyGeneratorSolver?.visualize()
    const topologyMergingViz = this.topologyMergingSolver?.visualize()
    const nodeSubdivisionViz = this.nodeDimensionSubdivisionSolver?.visualize()
    const nodeTargetMergerViz = this.nodeTargetMerger?.visualize()
    const singleLayerNodeMergerViz = this.singleLayerNodeMerger?.visualize()
    const strawSolverViz = this.strawSolver?.visualize()
    const edgeViz = this.edgeSolver?.visualize()
    const deadEndViz = this.deadEndSolver?.visualize()
    const availableSegmentPointViz =
      this.availableSegmentPointSolver?.visualize()
    const portPointPathingViz = this.portPointPathingSolver?.visualize()
    const multiSectionOptViz = this.multiSectionPortPointOptimizer?.visualize()
    const uniformPortDistributionViz =
      this.uniformPortDistributionSolver?.visualize()
    const highDensityViz = this.highDensityRouteSolver?.visualize()
    const highDensityForceImproveViz =
      this.highDensityForceImproveSolver?.visualize()
    const highDensityRepairViz = this.highDensityRepairSolver?.visualize()
    const highDensityStitchViz = this.highDensityStitchSolver?.visualize()
    const traceSimplificationViz = this.traceSimplificationSolver?.visualize()
    const lengthMatchingPostProcessingViz =
      this.lengthMatchingPostProcessingSolver?.visualize()
    const traceWidthViz = this.traceWidthSolver?.visualize()
    const necessaryCrampedPortPointSolverViz =
      this.necessaryCrampedPortPointSolver?.visualize()
    const highDensityRouteSolverViz = this.highDensityRouteSolver?.visualize()
    const srjToVisualize = this.originalSrj
    const problemOutline = srjToVisualize.outline
    const problemLines: Line[] = []

    problemLines.push({
      points: [
        {
          x: srjToVisualize.bounds?.minX ?? -50,
          y: srjToVisualize.bounds?.minY ?? -50,
        },
        {
          x: srjToVisualize.bounds?.maxX ?? 50,
          y: srjToVisualize.bounds?.minY ?? -50,
        },
        {
          x: srjToVisualize.bounds?.maxX ?? 50,
          y: srjToVisualize.bounds?.maxY ?? 50,
        },
        {
          x: srjToVisualize.bounds?.minX ?? -50,
          y: srjToVisualize.bounds?.maxY ?? 50,
        },
        {
          x: srjToVisualize.bounds?.minX ?? -50,
          y: srjToVisualize.bounds?.minY ?? -50,
        },
      ],
      strokeColor: "rgba(255,0,0,0.25)",
    })

    if (problemOutline && problemOutline.length >= 2) {
      const outlinePoints = problemOutline.map(
        (point: { x: number; y: number }) => ({
          x: point.x,
          y: point.y,
        }),
      )

      outlinePoints.push({ ...outlinePoints[0]! })

      problemLines.push({
        points: outlinePoints,
        strokeColor: "rgba(0, 136, 255, 0.95)",
      })
    }

    const formatObstacleLabel = createObstacleLabelFormatter(srjToVisualize)

    const problemBaseViz = {
      points: [
        ...srjToVisualize.connections.flatMap((c) =>
          c.pointsToConnect.map((p) => ({
            ...p,
            layer: getGraphicsLayerForConnectionPoint(
              p,
              srjToVisualize.layerCount,
            ),
            label: `${c.name} ${p.pcb_port_id ?? ""}`,
          })),
        ),
      ],
      rects: [
        ...(srjToVisualize.obstacles ?? [])
          .filter((o) => !o.isCopperPour)
          .map((o) => ({
            ...o,
            fill: o.layers?.includes("top")
              ? "rgba(255,0,0,0.25)"
              : o.layers?.includes("bottom")
                ? "rgba(0,0,255,0.25)"
                : "rgba(255,0,0,0.25)",
            layer: getGraphicsLayerForObstacle(o, srjToVisualize.layerCount),
            label: formatObstacleLabel(o),
          })),
      ],
      lines: problemLines,
    } as GraphicsObject
    const visualizationOptions = {
      traceColorMode: this.visualizationTraceColorMode,
    } as const
    const routeViz = getPresuppliedTraceVisualization({
      srj: srjToVisualize,
      visualizationOptions,
    })
    const problemViz = combineVisualizations(problemBaseViz, routeViz)
    const processedProblemViz =
      this.preprocessSimpleRouteJsonSolver?.visualize()
    const globalDrcForceImproveViz =
      this.globalDrcForceImproveSolver?.visualize()
    const exactGeometryDrcForceImproveViz =
      this.exactGeometryDrcForceImproveSolver?.visualize()
    const visualizations = [
      problemViz,
      processedProblemViz,
      componentDetectionViz,
      componentTopologyGeneratorViz,
      escapeViaLocationViz,
      netToPPSolver,
      globalTopologyGeneratorViz,
      topologyMergingViz,
      nodeSubdivisionViz,
      nodeTargetMergerViz,
      singleLayerNodeMergerViz,
      strawSolverViz,
      edgeViz,
      deadEndViz,
      availableSegmentPointViz,
      necessaryCrampedPortPointSolverViz,
      portPointPathingViz,
      multiSectionOptViz,
      uniformPortDistributionViz,
      highDensityViz
        ? combineVisualizations(problemBaseViz, highDensityViz)
        : null,
      highDensityForceImproveViz,
      highDensityRepairViz,
      highDensityStitchViz,
      traceSimplificationViz,
      traceWidthViz,
      globalDrcForceImproveViz,
      exactGeometryDrcForceImproveViz,
      lengthMatchingPostProcessingViz,
      this.solved
        ? combineVisualizations(
            { lines: problemLines },
            getPresuppliedTraceVisualization({
              srj: this.originalSrj,
              visualizationOptions,
            }),
            this.visualizeFinalOutput(),
          )
        : null,
    ].filter(Boolean) as GraphicsObject[]
    const graphics = combineVisualizations(...visualizations)
    return this.visualizationTraceColorMode === "net"
      ? applyNetColorsToGraphicsObject(graphics, this.colorMap)
      : graphics
  }

  visualizeStage(stageSolver: {
    visualize: () => GraphicsObject
  }): GraphicsObject {
    const graphics = stageSolver.visualize()
    return this.visualizationTraceColorMode === "net"
      ? applyNetColorsToGraphicsObject(graphics, this.colorMap)
      : graphics
  }

  visualizeFinalOutput(): GraphicsObject {
    const traceColorMode = this.visualizationTraceColorMode
    const outputSrj = this.getOutputSimpleRouteJson()
    const graphics = convertSrjToGraphicsObject(outputSrj, {
      traceColorMode,
    })
    return graphics
  }

  preview(): GraphicsObject {
    if (this.highDensityRouteSolver) {
      const lines: Line[] = []
      for (let i = this.highDensityRouteSolver.routes.length - 1; i >= 0; i--) {
        const route = this.highDensityRouteSolver.routes[i]
        lines.push({
          points: route.route.map((n) => ({
            x: n.x,
            y: n.y,
          })),
          strokeColor: this.colorMap[route.connectionName],
        })
        if (lines.length > 200) break
      }
      return { lines }
    }

    if (this.portPointPathingSolver) {
      return this.portPointPathingSolver.preview()
    }

    if (this.netToPointPairsSolver) {
      return this.netToPointPairsSolver.visualize()
    }
    if (this.escapeViaLocationSolver) {
      return this.escapeViaLocationSolver.visualize()
    }
    if (this.componentTopologyGeneratorSolver) {
      return this.componentTopologyGeneratorSolver.visualize()
    }
    if (this.componentDetectionSolver) {
      return this.componentDetectionSolver.visualize()
    }
    if (this.preprocessSimpleRouteJsonSolver) {
      return this.preprocessSimpleRouteJsonSolver.visualize()
    }

    return {}
  }

  _getOutputHdRoutes(): HighDensityRoute[] {
    if (this.lengthMatchingPostProcessingSolver) {
      const { hdRoutes } = this.lengthMatchingPostProcessingSolver.getOutput()
      return hdRoutes
    }
    return (
      this.exactGeometryDrcForceImproveSolver?.getOutput() ??
      this.globalDrcForceImproveSolver?.getOutput() ??
      this.traceWidthSolver?.getHdRoutesWithWidths() ??
      this.traceSimplificationSolver?.simplifiedHdRoutes ??
      this.highDensityStitchSolver!.mergedHdRoutes
    )
  }

  getOutputSimplifiedPcbTraces(): SimplifiedPcbTraces {
    if (!this.solved || !this.highDensityRouteSolver) {
      throw new Error("Cannot get output before solving is complete")
    }

    if (this.powerTraceExpansionSolver) {
      return this.powerTraceExpansionSolver.getOutput()
    }

    return this.getPrePowerTraceOutputSimplifiedPcbTraces()
  }

  getPrePowerTraceOutputSimplifiedPcbTraces(): SimplifiedPcbTraces {
    return convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: this.netToPointPairsSolver?.newConnections ?? [],
      originalConnections: this.originalSrj.connections,
      hdRoutes: this._getOutputHdRoutes(),
      layerCount: this.srj.layerCount,
      obstacles: this.srj.obstacles,
      defaultViaHoleDiameter: this.viaHoleDiameter,
      connMap: this.connMap,
    })
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return {
      ...this.originalSrj,
      traces: this.getOutputSimplifiedPcbTraces(),
    }
  }
}
