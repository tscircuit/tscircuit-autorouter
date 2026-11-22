import { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import { retainRequiredCrampedPortPoints } from "lib/solvers/NecessaryCrampedPortPointSolver/retainRequiredCrampedPortPoints"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import { MultiGraphTopologyPlannerSolver } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { getColorMap } from "lib/solvers/colors"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import {
  AvailableSegmentPointSolver,
  type SharedEdgeSegment,
} from "../../solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "../../solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { EscapeViaLocationSolver } from "../../solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import { NetToPointPairsSolver2_OffBoardConnection } from "../../solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { PreloadedTraceGraphSolver } from "./PreloadedTraceGraphSolver"
import { MergedComponentTopologyView } from "../AutoroutingPipeline7_MultiGraph/MergedComponentTopologyView"
import { definePipeline9Step } from "./definePipeline9Step"

function getComponentCapacityMeshNodeIds(
  capacityMeshNodes: CapacityMeshNode[] | null,
): Set<CapacityMeshNodeId> {
  return new Set(
    (capacityMeshNodes ?? [])
      .filter((node) => node._isComponentTopologyNode)
      .map((node) => node.capacityMeshNodeId),
  )
}

function isComponentSharedEdgeSegment(
  segment: SharedEdgeSegment,
  componentCapacityMeshNodeIds: ReadonlySet<CapacityMeshNodeId>,
): boolean {
  return segment.nodeIds.some((nodeId) =>
    componentCapacityMeshNodeIds.has(nodeId),
  )
}

/** Restore component-local edges after filtering cramped ports outside components. */
function mergeComponentSharedEdgeSegments({
  originalSharedEdgeSegments,
  filteredSharedEdgeSegments,
  componentCapacityMeshNodeIds,
}: {
  originalSharedEdgeSegments: SharedEdgeSegment[]
  filteredSharedEdgeSegments: SharedEdgeSegment[]
  componentCapacityMeshNodeIds: ReadonlySet<CapacityMeshNodeId>
}): SharedEdgeSegment[] {
  const filteredSegmentsByEdgeId = new Map(
    filteredSharedEdgeSegments.map((segment) => [segment.edgeId, segment]),
  )
  return originalSharedEdgeSegments.map((segment) =>
    isComponentSharedEdgeSegment(segment, componentCapacityMeshNodeIds)
      ? segment
      : (filteredSegmentsByEdgeId.get(segment.edgeId) ?? segment),
  )
}

export const pipeline9TopologySteps = [
  definePipeline9Step({
    solverName: "componentDetectionSolver",
    solverClass: ComponentDetectionSolver,
    getConstructorParams: (pipeline) => [{ inputSrj: pipeline.srj }],
  }),
  definePipeline9Step({
    solverName: "escapeViaLocationSolver",
    solverClass: EscapeViaLocationSolver,
    getConstructorParams: (pipeline) => [
      pipeline.srj,
      {
        connMap: pipeline.connMap,
        viaDiameter: pipeline.viaDiameter,
        minTraceWidth: pipeline.minTraceWidth,
        obstacleMargin: pipeline.srj.defaultObstacleMargin ?? 0.15,
      },
    ],
    onSolved: (pipeline) => {
      pipeline.srjWithEscapeViaLocations =
        pipeline.escapeViaLocationSolver?.getOutputSimpleRouteJson()
    },
  }),
  definePipeline9Step({
    solverName: "netToPointPairsSolver",
    solverClass: NetToPointPairsSolver2_OffBoardConnection,
    getConstructorParams: (pipeline) => {
      const inputSrj = pipeline.srjWithEscapeViaLocations ?? pipeline.srj
      return [
        inputSrj,
        pipeline.colorMap,
        getInitiallyConnectedMapFromSimpleRouteJson(inputSrj),
      ]
    },
    onSolved: (pipeline) => {
      pipeline.srjWithPointPairs =
        pipeline.netToPointPairsSolver?.getNewSimpleRouteJson()
      pipeline.colorMap = getColorMap(
        pipeline.srjWithPointPairs!,
        pipeline.connMap,
      )
      pipeline.connMap = getConnectivityMapFromSimpleRouteJson(
        pipeline.srjWithPointPairs!,
      )
    },
  }),
  definePipeline9Step({
    solverName: "topologyPlanningSolver",
    solverClass: MultiGraphTopologyPlannerSolver,
    getConstructorParams: (pipeline) => [
      {
        inputSrj: pipeline.srjWithPointPairs!,
        componentDetectionOutput:
          pipeline.componentDetectionSolver!.getOutput(),
        viaDiameter: pipeline.viaDiameter,
        obstacleMargin: pipeline.srj.defaultObstacleMargin ?? 0.15,
      },
    ],
    onSolved: (pipeline) => {
      pipeline.globalTopologyGeneratorSolver =
        pipeline.topologyPlanningSolver!.globalTopologySolver
      pipeline.componentTopologyGeneratorSolver =
        new MergedComponentTopologyView(pipeline.topologyPlanningSolver!)
    },
  }),
  definePipeline9Step({
    solverName: "topologyMergingSolver",
    solverClass: TopologyMergingSolver,
    getConstructorParams: (pipeline) => {
      const topologyOutput = pipeline.topologyPlanningSolver!.getOutput()

      return [
        {
          layerCount: pipeline.srj.layerCount,
          allowBlindAndBuriedVias: pipeline.srj.allowBlindAndBuriedVias,
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
    onSolved: (pipeline) => {
      pipeline.capacityNodes = pipeline.topologyMergingSolver!.getOutput()
    },
  }),
  definePipeline9Step({
    solverName: "nodeDimensionSubdivisionSolver",
    solverClass: NodeDimensionSubdivisionSolver,
    getConstructorParams: (pipeline) => [
      pipeline.capacityNodes!,
      pipeline.maxNodeDimension,
      pipeline.maxNodeRatio,
      pipeline.minNodeArea,
    ],
    onSolved: (pipeline) => {
      pipeline.capacityNodes =
        pipeline.nodeDimensionSubdivisionSolver!.outputNodes
    },
  }),
  definePipeline9Step({
    solverName: "edgeSolver",
    solverClass: CapacityMeshEdgeSolver2_NodeTreeOptimization,
    getConstructorParams: (pipeline) => [pipeline.capacityNodes!],
    onSolved: (pipeline) => {
      pipeline.capacityEdges = pipeline.edgeSolver?.edges!
    },
  }),
  definePipeline9Step({
    solverName: "availableSegmentPointSolver",
    solverClass: AvailableSegmentPointSolver,
    getConstructorParams: (pipeline) => [
      {
        nodes: pipeline.capacityNodes!,
        edges: pipeline.capacityEdges || [],
        traceWidth: pipeline.minTraceWidth,
        colorMap: pipeline.colorMap,
        shouldReturnCrampedPortPoints: true,
        connections: pipeline.srjWithPointPairs!.connections,
      },
    ],
  }),
  definePipeline9Step({
    solverName: "necessaryCrampedPortPointSolver",
    solverClass: MultiTargetNecessaryCrampedPortPointSolver,
    getConstructorParams: (pipeline) => {
      const componentCapacityMeshNodeIds = getComponentCapacityMeshNodeIds(
        pipeline.capacityNodes,
      )

      return [
        {
          capacityMeshNodes: pipeline.capacityNodes!.filter(
            (node) =>
              !componentCapacityMeshNodeIds.has(node.capacityMeshNodeId),
          ),
          // Do not let the cramped-port solver remove component-local port
          // points. Those regions are generated by the topology planner and
          // remain valid even when the generated port points are cramped.
          sharedEdgeSegments: pipeline
            .availableSegmentPointSolver!.getOutput()
            .filter(
              (segment) =>
                !isComponentSharedEdgeSegment(
                  segment,
                  componentCapacityMeshNodeIds,
                ),
            ),
          simpleRouteJson: pipeline.srjWithPointPairs!,
          preserveConnectionReachability: true,
        },
      ]
    },
    onSolved: (pipeline) => {
      const componentCapacityMeshNodeIds = getComponentCapacityMeshNodeIds(
        pipeline.capacityNodes,
      )

      const filteredSegments = mergeComponentSharedEdgeSegments({
        originalSharedEdgeSegments:
          pipeline.availableSegmentPointSolver!.getOutput(),
        filteredSharedEdgeSegments:
          pipeline.necessaryCrampedPortPointSolver!.getOutput(),
        componentCapacityMeshNodeIds,
      })
      pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints =
        retainRequiredCrampedPortPoints({
          nodes: pipeline.capacityNodes!,
          originalSegments: pipeline.availableSegmentPointSolver!.getOutput(),
          filteredSegments,
          connections: pipeline.srjWithPointPairs!.connections,
        })
    },
  }),
  definePipeline9Step({
    solverName: "preloadedTraceGraphSolver",
    solverClass: PreloadedTraceGraphSolver,
    getConstructorParams: (pipeline) => [
      pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints!,
      pipeline.srjWithPointPairs!,
    ],
  }),
]
