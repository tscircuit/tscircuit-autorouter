import type { GraphicsObject, Line } from "graphics-debug"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
  TraceId,
} from "lib/types"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { CapacityMeshNodeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver1"
import { CapacityMeshNodeSolver2_NodeUnderObstacle } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver2_NodesUnderObstacles"
import { CapacityPathingSolver } from "lib/solvers/CapacityPathingSolver/CapacityPathingSolver"
import { CapacityEdgeToPortSegmentSolver } from "lib/solvers/CapacityMeshSolver/CapacityEdgeToPortSegmentSolver"
import { getColorMap } from "lib/solvers/colors"
import { CapacitySegmentToPointSolver } from "lib/solvers/CapacityMeshSolver/CapacitySegmentToPointSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type { NodePortSegment } from "lib/types/capacity-edges-to-port-segments-types"
import { CapacityPathingSolver2_AvoidLowCapacity } from "lib/solvers/CapacityPathingSolver/CapacityPathingSolver2_AvoidLowCapacity"
import { CapacityPathingSolver3_FlexibleNegativeCapacity_AvoidLowCapacity } from "lib/solvers/CapacityPathingSolver/CapacityPathingSolver3_FlexibleNegativeCapacity_AvoidLowCapacity"
import { CapacityPathingSolver4_FlexibleNegativeCapacity } from "lib/solvers/CapacityPathingSolver/CapacityPathingSolver4_FlexibleNegativeCapacity_AvoidLowCapacity_FixedDistanceCost"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { CapacityNodeTargetMerger } from "lib/solvers/CapacityNodeTargetMerger/CapacityNodeTargetMerger"
import { CapacitySegmentPointOptimizer } from "lib/solvers/CapacitySegmentPointOptimizer/CapacitySegmentPointOptimizer"
import { calculateOptimalCapacityDepth } from "lib/utils/getTunedTotalCapacity1"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mergeRouteSegments } from "lib/utils/mergeRouteSegments"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { MultipleHighDensityRouteStitchSolver } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { UnravelMultiSectionSolver } from "lib/solvers/UnravelSolver/UnravelMultiSectionSolver"
import { CapacityPathingMultiSectionSolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingMultiSectionSolver"
import { StrawSolver } from "lib/solvers/StrawSolver/StrawSolver"
import { SingleLayerNodeMergerSolver } from "lib/solvers/SingleLayerNodeMerger/SingleLayerNodeMergerSolver"
import { CapacityNodeTargetMerger2 } from "lib/solvers/CapacityNodeTargetMerger/CapacityNodeTargetMerger2"
import { SingleSimplifiedPathSolver } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver"
import { MultiSimplifiedPathSolver } from "lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import {
  HighDensityIntraNodeRoute,
  HighDensityRoute,
} from "lib/types/high-density-types"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { DeadEndSolver } from "lib/solvers/DeadEndSolver/DeadEndSolver"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import { CapacityPathingSolver5 } from "lib/solvers/CapacityPathingSolver/CapacityPathingSolver5"
import { CapacityPathingGreedySolver } from "lib/solvers/CapacityPathingSectionSolver/CapacityPathingGreedySolver"
import { CacheProvider } from "lib/cache/types"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { RectDiffPipeline } from "@tscircuit/rectdiff"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { NoOffBoardMultipleHighDensityRouteStitchSolver } from "lib/solvers/RouteStitchingSolver/NoOffBoardMultipleHighDensityRouteStitchSolver"

interface CapacityMeshSolverOptions {
  capacityDepth?: number
  targetMinCapacity?: number
  cacheProvider?: CacheProvider | null
}
export type AutoroutingPipelineSolverOptions = CapacityMeshSolverOptions

type PipelineStep<T extends new (...args: any[]) => BaseSolver> = {
  solverName: string
  solverClass: T
  getConstructorParams: (
    instance: AutoroutingPipeline1_OriginalUnravel,
  ) => ConstructorParameters<T>
  onSolved?: (instance: AutoroutingPipeline1_OriginalUnravel) => void
}

function definePipelineStep<
  T extends new (
    ...args: any[]
  ) => BaseSolver,
  const P extends ConstructorParameters<T>,
>(
  solverName: keyof AutoroutingPipeline1_OriginalUnravel,
  solverClass: T,
  getConstructorParams: (instance: AutoroutingPipeline1_OriginalUnravel) => P,
  opts: {
    onSolved?: (instance: AutoroutingPipeline1_OriginalUnravel) => void
  } = {},
): PipelineStep<T> {
  return {
    solverName,
    solverClass,
    getConstructorParams,
    onSolved: opts.onSolved,
  }
}

export class AutoroutingPipeline1_OriginalUnravel extends BaseSolver {
  netToPointPairsSolver?: NetToPointPairsSolver
  nodeSolver?: CapacityMeshNodeSolver
  nodeTargetMerger?: CapacityNodeTargetMerger
  edgeSolver?: CapacityMeshEdgeSolver
  initialPathingSolver?: CapacityPathingGreedySolver
  pathingOptimizer?: CapacityPathingMultiSectionSolver
  edgeToPortSegmentSolver?: CapacityEdgeToPortSegmentSolver
  colorMap: Record<string, string>
  segmentToPointSolver?: CapacitySegmentToPointSolver
  unravelMultiSectionSolver?: UnravelMultiSectionSolver
  segmentToPointOptimizer?: CapacitySegmentPointOptimizer
  highDensityRouteSolver?: HighDensitySolver
  highDensityStitchSolver?: NoOffBoardMultipleHighDensityRouteStitchSolver
  singleLayerNodeMerger?: SingleLayerNodeMergerSolver
  strawSolver?: StrawSolver
  deadEndSolver?: DeadEndSolver
  traceSimplificationSolver?: TraceSimplificationSolver
  viaDiameter: number
  minTraceWidth: number

  startTimeOfPhase: Record<string, number>
  endTimeOfPhase: Record<string, number>
  timeSpentOnPhase: Record<string, number>

  activeSubSolver?: BaseSolver | null = null
  connMap: ConnectivityMap
  srjWithPointPairs?: SimpleRouteJson
  capacityNodes: CapacityMeshNode[] | null = null
  capacityEdges: CapacityMeshEdge[] | null = null

  cacheProvider: CacheProvider | null = null

  pipelineDef = [
    definePipelineStep(
      "netToPointPairsSolver",
      NetToPointPairsSolver2_OffBoardConnection,
      (cms) => [cms.srj, cms.colorMap],
      {
        onSolved: (cms) => {
          cms.srjWithPointPairs =
            cms.netToPointPairsSolver?.getNewSimpleRouteJson()
          cms.colorMap = getColorMap(cms.srjWithPointPairs!, this.connMap)
          cms.connMap = getConnectivityMapFromSimpleRouteJson(
            cms.srjWithPointPairs!,
          )
        },
      },
    ),
    definePipelineStep(
      "nodeSolver",
      CapacityMeshNodeSolver2_NodeUnderObstacle,
      (cms) => [
        cms.netToPointPairsSolver?.getNewSimpleRouteJson() || cms.srj,
        cms.opts,
      ],
      {
        onSolved: (cms) => {
          cms.capacityNodes = cms.nodeSolver?.finishedNodes!
        },
      },
    ),
    // definePipelineStep("nodeTargetMerger", CapacityNodeTargetMerger, (cms) => [
    //   cms.nodeSolver?.finishedNodes || [],
    //   cms.srj.obstacles,
    //   cms.connMap,
    // ]),
    // definePipelineStep("nodeTargetMerger", CapacityNodeTargetMerger2, (cms) => [
    //   cms.nodeSolver?.finishedNodes || [],
    //   cms.srj.obstacles,
    //   cms.connMap,
    //   cms.colorMap,
    //   cms.srj.connections,
    // ]),
    definePipelineStep(
      "singleLayerNodeMerger",
      SingleLayerNodeMergerSolver,
      (cms) => [cms.nodeSolver?.finishedNodes!],
      {
        onSolved: (cms) => {
          cms.capacityNodes = cms.singleLayerNodeMerger?.newNodes!
        },
      },
    ),
    definePipelineStep(
      "strawSolver",
      StrawSolver,
      (cms) => [{ nodes: cms.singleLayerNodeMerger?.newNodes! }],
      {
        onSolved: (cms) => {
          cms.capacityNodes = cms.strawSolver?.getResultNodes()!
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
      "deadEndSolver",
      DeadEndSolver,
      (cms) => [{ nodes: cms.capacityNodes!, edges: cms.capacityEdges! }],
      {
        onSolved: (cms) => {
          const removedNodeIds = cms.deadEndSolver?.removedNodeIds!

          cms.capacityNodes = cms.capacityNodes!.filter(
            (n) => !removedNodeIds.has(n.capacityMeshNodeId),
          )
          cms.capacityEdges = cms.capacityEdges!.filter((e) =>
            e.nodeIds.every((nodeId) => !removedNodeIds.has(nodeId)),
          )
        },
      },
    ),
    definePipelineStep(
      "initialPathingSolver",
      CapacityPathingGreedySolver,
      (cms) => [
        {
          simpleRouteJson: cms.srjWithPointPairs!,
          nodes: cms.capacityNodes!,
          edges: cms.capacityEdges || [],
          colorMap: cms.colorMap,
          hyperParameters: {
            MAX_CAPACITY_FACTOR: 1,
          },
        },
      ],
    ),
    definePipelineStep(
      "pathingOptimizer",
      // CapacityPathingSolver5,
      CapacityPathingMultiSectionSolver,
      (cms) => [
        // Replaced solver class
        {
          initialPathingSolver: cms.initialPathingSolver,
          simpleRouteJson: cms.srjWithPointPairs!,
          nodes: cms.capacityNodes!,
          edges: cms.capacityEdges || [],
          colorMap: cms.colorMap,
          cacheProvider: cms.cacheProvider,
          hyperParameters: {
            MAX_CAPACITY_FACTOR: 1,
          },
        },
      ],
    ),
    definePipelineStep(
      "edgeToPortSegmentSolver",
      CapacityEdgeToPortSegmentSolver,
      (cms) => [
        {
          nodes: cms.capacityNodes!,
          edges: cms.capacityEdges || [],
          capacityPaths: cms.pathingOptimizer?.getCapacityPaths() || [],
          colorMap: cms.colorMap,
        },
      ],
    ),
    definePipelineStep(
      "segmentToPointSolver",
      CapacitySegmentToPointSolver,
      (cms) => {
        const allSegments: NodePortSegment[] = []
        if (cms.edgeToPortSegmentSolver?.nodePortSegments) {
          cms.edgeToPortSegmentSolver.nodePortSegments.forEach((segs) => {
            allSegments.push(...segs)
          })
        }
        return [
          {
            segments: allSegments,
            colorMap: cms.colorMap,
            nodes: cms.capacityNodes!,
          },
        ]
      },
    ),
    // definePipelineStep(
    //   "segmentToPointOptimizer",
    //   CapacitySegmentPointOptimizer,
    //   (cms) => [
    //     {
    //       assignedSegments: cms.segmentToPointSolver?.solvedSegments || [],
    //       colorMap: cms.colorMap,
    //       nodes: cms.nodeTargetMerger?.newNodes || [],
    //       viaDiameter: cms.viaDiameter,
    //     },
    //   ],
    // ),
    definePipelineStep(
      "unravelMultiSectionSolver",
      UnravelMultiSectionSolver,
      (cms) => [
        {
          assignedSegments: cms.segmentToPointSolver?.solvedSegments || [],
          colorMap: cms.colorMap,
          nodes: cms.capacityNodes!,
          cacheProvider: this.cacheProvider,
        },
      ],
    ),
    definePipelineStep("highDensityRouteSolver", HighDensitySolver, (cms) => [
      {
        nodePortPoints:
          cms.unravelMultiSectionSolver?.getNodesWithPortPoints() ??
          cms.segmentToPointOptimizer?.getNodesWithPortPoints() ??
          [],
        colorMap: cms.colorMap,
        connMap: cms.connMap,
        viaDiameter: cms.viaDiameter,
        traceWidth: cms.minTraceWidth,
      },
    ]),
    definePipelineStep(
      "highDensityStitchSolver",
      NoOffBoardMultipleHighDensityRouteStitchSolver,
      (cms) => [
        {
          connections: cms.srjWithPointPairs!.connections,
          hdRoutes: cms.highDensityRouteSolver!.routes,
          colorMap: cms.colorMap,
          layerCount: cms.srj.layerCount,
          defaultViaDiameter: cms.viaDiameter,
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
        },
      ],
    ),
  ]

  constructor(
    public srj: SimpleRouteJson,
    public opts: CapacityMeshSolverOptions = {},
  ) {
    super()
    this.MAX_ITERATIONS = 100e6
    this.viaDiameter = srj.minViaDiameter ?? 0.6
    this.minTraceWidth = srj.minTraceWidth

    // If capacityDepth is not provided, calculate it automatically
    if (opts.capacityDepth === undefined) {
      // Calculate max width/height from bounds for initial node size
      const boundsWidth = srj.bounds.maxX - srj.bounds.minX
      const boundsHeight = srj.bounds.maxY - srj.bounds.minY
      const maxWidthHeight = Math.max(boundsWidth, boundsHeight)

      // Use the calculateOptimalCapacityDepth function to determine the right depth
      const targetMinCapacity = opts.targetMinCapacity ?? 0.5
      opts.capacityDepth = calculateOptimalCapacityDepth(
        maxWidthHeight,
        targetMinCapacity,
      )
    }

    this.connMap = getConnectivityMapFromSimpleRouteJson(srj)
    this.colorMap = getColorMap(srj, this.connMap)
    this.cacheProvider =
      opts.cacheProvider === undefined
        ? getGlobalInMemoryCache()
        : opts.cacheProvider === null
          ? null
          : opts.cacheProvider
    this.startTimeOfPhase = {}
    this.endTimeOfPhase = {}
    this.timeSpentOnPhase = {}
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
    if (!this.solved && this.activeSubSolver)
      return this.activeSubSolver.visualize()
    const netToPPSolver = this.netToPointPairsSolver?.visualize()
    const nodeViz = this.nodeSolver?.visualize()
    const nodeTargetMergerViz = this.nodeTargetMerger?.visualize()
    const singleLayerNodeMergerViz = this.singleLayerNodeMerger?.visualize()
    const strawSolverViz = this.strawSolver?.visualize()
    const edgeViz = this.edgeSolver?.visualize()
    const deadEndViz = this.deadEndSolver?.visualize()
    const initialPathingViz = this.initialPathingSolver?.visualize()
    const pathingOptimizerViz = this.pathingOptimizer?.visualize()
    const edgeToPortSegmentViz = this.edgeToPortSegmentSolver?.visualize()
    const segmentToPointViz = this.segmentToPointSolver?.visualize()
    const segmentOptimizationViz =
      this.unravelMultiSectionSolver?.visualize() ??
      this.segmentToPointOptimizer?.visualize()
    const highDensityViz = this.highDensityRouteSolver?.visualize()
    const highDensityStitchViz = this.highDensityStitchSolver?.visualize()
    const traceSimplificationViz = this.traceSimplificationSolver?.visualize()
    const problemOutline = this.srj.outline
    const problemLines: Line[] = []

    problemLines.push({
      points: [
        // Add five points representing the bounds of the PCB
        {
          x: this.srj.bounds?.minX ?? -50,
          y: this.srj.bounds?.minY ?? -50,
        },
        { x: this.srj.bounds?.maxX ?? 50, y: this.srj.bounds?.minY ?? -50 },
        { x: this.srj.bounds?.maxX ?? 50, y: this.srj.bounds?.maxY ?? 50 },
        { x: this.srj.bounds?.minX ?? -50, y: this.srj.bounds?.maxY ?? 50 },
        {
          x: this.srj.bounds?.minX ?? -50,
          y: this.srj.bounds?.minY ?? -50,
        }, // Close the rectangle
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

    const problemViz = {
      points: [
        ...this.srj.connections.flatMap((c) =>
          c.pointsToConnect.map((p) => ({
            ...p,
            label: `${c.name} ${p.pcb_port_id ?? ""}`,
          })),
        ),
      ],
      rects: [
        ...(this.srj.obstacles ?? []).map((o) => ({
          ...o,
          fill: o.layers?.includes("top")
            ? "rgba(255,0,0,0.25)"
            : o.layers?.includes("bottom")
              ? "rgba(0,0,255,0.25)"
              : "rgba(255,0,0,0.25)",
          label: o.layers?.join(", "),
        })),
      ],
      lines: problemLines,
    } as GraphicsObject
    const visualizations = [
      problemViz,
      netToPPSolver,
      nodeViz,
      nodeTargetMergerViz,
      singleLayerNodeMergerViz,
      strawSolverViz,
      edgeViz,
      deadEndViz,
      initialPathingViz,
      pathingOptimizerViz,
      edgeToPortSegmentViz,
      segmentToPointViz,
      segmentOptimizationViz,
      highDensityViz ? combineVisualizations(problemViz, highDensityViz) : null,
      highDensityStitchViz,
      traceSimplificationViz,
      this.solved
        ? combineVisualizations(
            problemViz,
            convertSrjToGraphicsObject(this.getOutputSimpleRouteJson()),
          )
        : null,
    ].filter(Boolean) as GraphicsObject[]
    // return visualizations[visualizations.length - 1]
    return combineVisualizations(...visualizations)
  }

  /**
   * A lightweight version of the visualize method that can be used to stream
   * progress
   *
   * We return the most relevant graphic for the stage:
   * 1. netToPointPairs output
   * 2. Capacity Planning Output
   * 3. High Density Route Solver Output, max 200 lines
   */
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

    if (this.pathingOptimizer) {
      const lines: Line[] = []
      for (const connection of this.pathingOptimizer.connectionsWithNodes) {
        if (!connection.path) continue
        lines.push({
          points: connection.path.map((n) => ({
            x: n.center.x,
            y: n.center.y,
          })),
          strokeColor: this.colorMap[connection.connection.name],
        })
      }
      return { lines }
    }

    // This output is good as-is
    if (this.netToPointPairsSolver) {
      return this.netToPointPairsSolver?.visualize()
    }

    return {}
  }

  _getOutputHdRoutes(): HighDensityRoute[] {
    return (
      this.traceSimplificationSolver?.simplifiedHdRoutes ??
      this.highDensityStitchSolver!.mergedHdRoutes
    )
  }

  /**
   * Returns the SimpleRouteJson with routes converted to SimplifiedPcbTraces
   */
  getOutputSimplifiedPcbTraces(): SimplifiedPcbTraces {
    if (!this.solved || !this.highDensityRouteSolver) {
      throw new Error("Cannot get output before solving is complete")
    }

    const traces: SimplifiedPcbTraces = []
    const allHdRoutes = this._getOutputHdRoutes()

    for (const connection of this.netToPointPairsSolver?.newConnections ?? []) {
      const netConnectionName =
        connection.netConnectionName ??
        this.srj.connections.find((c) => c.name === connection.name)
          ?.netConnectionName

      // Find all the hdRoutes that correspond to this connection
      const hdRoutes = allHdRoutes.filter(
        (r) => r.connectionName === connection.name,
      )

      for (let i = 0; i < hdRoutes.length; i++) {
        const hdRoute = hdRoutes[i]
        const simplifiedPcbTrace: SimplifiedPcbTrace = {
          type: "pcb_trace",
          pcb_trace_id: `${connection.name}_${i}`,
          connection_name:
            netConnectionName ??
            connection.rootConnectionName ??
            connection.name,
          route: convertHdRouteToSimplifiedRoute(hdRoute, this.srj.layerCount),
        }

        traces.push(simplifiedPcbTrace)
      }
    }

    return traces
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return {
      ...this.srj,
      traces: this.getOutputSimplifiedPcbTraces(),
    }
  }
}

/** @deprecated Use AutoroutingPipelineSolver instead */
export const CapacityMeshSolver = AutoroutingPipeline1_OriginalUnravel
export type CapacityMeshSolver = AutoroutingPipeline1_OriginalUnravel
