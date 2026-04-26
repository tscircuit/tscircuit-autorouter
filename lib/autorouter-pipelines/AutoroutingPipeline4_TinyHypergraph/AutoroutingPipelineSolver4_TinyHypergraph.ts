import { RectDiffPipeline } from "@tscircuit/rectdiff"
import { GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject, Line } from "graphics-debug"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { CacheProvider } from "lib/cache/types"
import { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { getColorMap } from "lib/solvers/colors"
import {
  CapacityMeshEdge,
  CapacityMeshNode,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { createObstacleLabelFormatter } from "lib/utils/formatObstacleLabel"
import {
  getGraphicsLayerForConnectionPoint,
  getGraphicsLayerForObstacle,
} from "lib/utils/getGraphicsObjectLayer"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { calculateOptimalCapacityDepth } from "lib/utils/getTunedTotalCapacity1"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { AvailableSegmentPointSolver } from "../../solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { BaseSolver } from "../../solvers/BaseSolver"
import { CapacityMeshEdgeSolver } from "../../solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "../../solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { CapacityNodeTargetMerger } from "../../solvers/CapacityNodeTargetMerger/CapacityNodeTargetMerger"
import { DeadEndSolver } from "../../solvers/DeadEndSolver/DeadEndSolver"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
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

interface CapacityMeshSolverOptions {
  capacityDepth?: number
  targetMinCapacity?: number
  cacheProvider?: CacheProvider | null
  effort?: number
  maxNodeDimension?: number
  maxNodeRatio?: number
  minNodeArea?: number
}
export type AutoroutingPipelineSolverOptions = CapacityMeshSolverOptions

type PipelineStep<T extends new (...args: any[]) => BaseSolver> = {
  solverName: string
  solverClass: T
  getConstructorParams: (
    instance: AutoroutingPipelineSolver4_TinyHypergraph,
  ) => ConstructorParameters<T>
  onSolved?: (instance: AutoroutingPipelineSolver4_TinyHypergraph) => void
}

function definePipelineStep<
  T extends new (
    ...args: any[]
  ) => BaseSolver,
  const P extends ConstructorParameters<T>,
>(
  solverName: keyof AutoroutingPipelineSolver4_TinyHypergraph,
  solverClass: T,
  getConstructorParams: (
    instance: AutoroutingPipelineSolver4_TinyHypergraph,
  ) => P,
  opts: {
    onSolved?: (instance: AutoroutingPipelineSolver4_TinyHypergraph) => void
  } = {},
): PipelineStep<T> {
  return {
    solverName,
    solverClass,
    getConstructorParams,
    onSolved: opts.onSolved,
  }
}

export class AutoroutingPipelineSolver4_TinyHypergraph extends BaseSolver {
  escapeViaLocationSolver?: EscapeViaLocationSolver
  netToPointPairsSolver?: NetToPointPairsSolver
  nodeSolver?: RectDiffPipeline
  nodeDimensionSubdivisionSolver?: NodeDimensionSubdivisionSolver
  nodeTargetMerger?: CapacityNodeTargetMerger
  edgeSolver?: CapacityMeshEdgeSolver
  colorMap: Record<string, string>
  highDensityRouteSolver?: HighDensitySolver
  highDensityForceImproveSolver?: HighDensityForceImproveSolver
  highDensityRepairSolver?: Pipeline4HighDensityRepairSolver
  highDensityStitchSolver?: MultipleHighDensityRouteStitchSolver3
  globalDrcForceImproveSolver?: GlobalDrcForceImproveSolver
  singleLayerNodeMerger?: SingleLayerNodeMergerSolver
  strawSolver?: StrawSolver
  deadEndSolver?: DeadEndSolver
  traceSimplificationSolver?: TraceSimplificationSolver
  availableSegmentPointSolver?: AvailableSegmentPointSolver
  portPointPathingSolver?: TinyHypergraphPortPointPathingSolver
  multiSectionPortPointOptimizer?: MultiSectionPortPointOptimizer
  uniformPortDistributionSolver?: UniformPortDistributionSolver
  traceWidthSolver?: TraceWidthSolver
  necessaryCrampedPortPointSolver?: MultiTargetNecessaryCrampedPortPointSolver
  viaDiameter: number
  viaHoleDiameter: number
  minTraceWidth: number
  effort: number
  maxNodeDimension: number
  maxNodeRatio: number
  minNodeArea: number

  startTimeOfPhase: Record<string, number>
  endTimeOfPhase: Record<string, number>
  timeSpentOnPhase: Record<string, number>

  activeSubSolver?: BaseSolver | null = null
  connMap: ConnectivityMap
  srjWithEscapeViaLocations?: SimpleRouteJson
  srjWithPointPairs?: SimpleRouteJson
  capacityNodes: CapacityMeshNode[] | null = null
  capacityEdges: CapacityMeshEdge[] | null = null
  highDensityNodePortPoints?: NodeWithPortPoints[]

  cacheProvider: CacheProvider | null = null
  pipelineDef = [
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
      (cms) => [cms.srjWithEscapeViaLocations ?? cms.srj, cms.colorMap],
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
      RectDiffPipeline,
      (cms) => [{ simpleRouteJson: cms.srjWithPointPairs! as any }],
      {
        onSolved: (cms) => {
          cms.capacityNodes = cms.nodeSolver?.getOutput().meshNodes ?? []
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
          cms.capacityNodes =
            cms.nodeDimensionSubdivisionSolver?.outputNodes ?? []
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
      (cms) => [
        {
          capacityMeshNodes: cms.capacityNodes!,
          sharedEdgeSegments: cms.availableSegmentPointSolver!.getOutput(),
          simpleRouteJson: cms.srjWithPointPairs!,
          numberOfCrampedPortPointsToKeep: 5,
        },
      ],
    ),
    definePipelineStep(
      "portPointPathingSolver",
      TinyHypergraphPortPointPathingSolver,
      (cms) => {
        const sharedEdgeSegments =
          cms.necessaryCrampedPortPointSolver?.getOutput() ??
          cms.availableSegmentPointSolver!.getOutput()
        const { graph, connections } = buildHyperGraph({
          capacityMeshNodes: cms.capacityNodes!,
          layerCount: cms.srj.layerCount,
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
            minViaPadDiameter: cms.viaDiameter,
            flags: {
              FORCE_CENTER_FIRST: true,
              RIPPING_ENABLED: true,
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

      cms.highDensityNodePortPoints = structuredClone(nodePortPointsSource)

      return [
        {
          nodePortPoints: nodePortPointsSource,
          nodePfById: new Map(
            (
              cms.portPointPathingSolver?.getOutput().inputNodeWithPortPoints ??
              []
            ).map((node) => [
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
          totalStepsPerNode: Math.max(20, Math.round(60 * cms.effort)),
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
        layerCount: cms.srj.layerCount,
      },
    ]),
    definePipelineStep(
      "globalDrcForceImproveSolver",
      GlobalDrcForceImproveSolver,
      (cms) => [
        {
          srj: cms.srjWithPointPairs! as any,
          hdRoutes: cms.traceWidthSolver!.getHdRoutesWithWidths(),
          effort: cms.effort,
        },
      ],
    ),
  ]

  constructor(
    public readonly srj: SimpleRouteJson,
    public readonly opts: CapacityMeshSolverOptions = {},
  ) {
    super()
    this.srj = srj
    this.opts = { ...opts }
    this.MAX_ITERATIONS = 100e6
    const viaDimensions = getViaDimensions(srj)
    this.viaDiameter = viaDimensions.padDiameter
    this.viaHoleDiameter = viaDimensions.holeDiameter
    this.minTraceWidth = srj.minTraceWidth
    const mutableOpts = this.opts
    this.effort = mutableOpts.effort ?? 1
    this.maxNodeDimension = mutableOpts.maxNodeDimension ?? 16
    this.maxNodeRatio = mutableOpts.maxNodeRatio ?? 6
    this.minNodeArea = mutableOpts.minNodeArea ?? 0.1 ** 2

    if (mutableOpts.capacityDepth === undefined) {
      const boundsWidth = srj.bounds.maxX - srj.bounds.minX
      const boundsHeight = srj.bounds.maxY - srj.bounds.minY
      const maxWidthHeight = Math.max(boundsWidth, boundsHeight)
      const targetMinCapacity = mutableOpts.targetMinCapacity ?? 0.5
      mutableOpts.capacityDepth = calculateOptimalCapacityDepth(
        maxWidthHeight,
        targetMinCapacity,
      )
    }

    this.connMap = getConnectivityMapFromSimpleRouteJson(srj)
    this.colorMap = getColorMap(srj, this.connMap)
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
    if (!this.solved && this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }
    const escapeViaLocationViz = this.escapeViaLocationSolver?.visualize()
    const netToPPSolver = this.netToPointPairsSolver?.visualize()
    const nodeViz = this.nodeSolver?.visualize()
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
    const necessaryCrampedPortPointSolverViz =
      this.necessaryCrampedPortPointSolver?.visualize()
    const highDensityRouteSolverViz = this.highDensityRouteSolver?.visualize()
    const problemOutline = this.srj.outline
    const problemLines: Line[] = []

    problemLines.push({
      points: [
        { x: this.srj.bounds?.minX ?? -50, y: this.srj.bounds?.minY ?? -50 },
        { x: this.srj.bounds?.maxX ?? 50, y: this.srj.bounds?.minY ?? -50 },
        { x: this.srj.bounds?.maxX ?? 50, y: this.srj.bounds?.maxY ?? 50 },
        { x: this.srj.bounds?.minX ?? -50, y: this.srj.bounds?.maxY ?? 50 },
        { x: this.srj.bounds?.minX ?? -50, y: this.srj.bounds?.minY ?? -50 },
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

    const formatObstacleLabel = createObstacleLabelFormatter(this.srj)

    const problemViz = {
      points: [
        ...this.srj.connections.flatMap((c) =>
          c.pointsToConnect.map((p) => ({
            ...p,
            layer: getGraphicsLayerForConnectionPoint(p, this.srj.layerCount),
            label: `${c.name} ${p.pcb_port_id ?? ""}`,
          })),
        ),
      ],
      rects: [
        ...(this.srj.obstacles ?? [])
          .filter((o) => !o.isCopperPour)
          .map((o) => ({
            ...o,
            fill: o.layers?.includes("top")
              ? "rgba(255,0,0,0.25)"
              : o.layers?.includes("bottom")
                ? "rgba(0,0,255,0.25)"
                : "rgba(255,0,0,0.25)",
            layer: getGraphicsLayerForObstacle(o, this.srj.layerCount),
            label: formatObstacleLabel(o),
          })),
      ],
      lines: problemLines,
    } as GraphicsObject
    const visualizations = [
      problemViz,
      escapeViaLocationViz,
      netToPPSolver,
      nodeViz,
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
      highDensityViz ? combineVisualizations(problemViz, highDensityViz) : null,
      highDensityForceImproveViz,
      highDensityRepairViz,
      highDensityStitchViz,
      traceSimplificationViz,
      this.solved
        ? combineVisualizations(
            problemViz,
            convertSrjToGraphicsObject(this.getOutputSimpleRouteJson()),
          )
        : null,
    ].filter(Boolean) as GraphicsObject[]
    return combineVisualizations(...visualizations)
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

    return {}
  }

  _getOutputHdRoutes(): HighDensityRoute[] {
    return (
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

    const traces: SimplifiedPcbTraces = []
    const allHdRoutes = this._getOutputHdRoutes()

    for (const connection of this.netToPointPairsSolver?.newConnections ?? []) {
      const netConnectionName =
        connection.netConnectionName ??
        this.srj.connections.find((c) => c.name === connection.name)
          ?.netConnectionName

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
          route: convertHdRouteToSimplifiedRoute(hdRoute, this.srj.layerCount, {
            connectionPoints: connection.pointsToConnect,
            defaultViaHoleDiameter: this.viaHoleDiameter,
            obstacles: this.srj.obstacles,
            connMap: this.connMap,
          }),
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

export {
  AutoroutingPipelineSolver4_TinyHypergraph as AutoroutingPipelineSolver4,
}
