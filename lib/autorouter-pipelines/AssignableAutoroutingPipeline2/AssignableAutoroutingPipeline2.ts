import type { GraphicsObject, Line } from "graphics-debug"
import { combineVisualizations } from "../../utils/combineVisualizations"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  ObstacleId,
  RootConnectionName,
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
  TraceId,
} from "../../types"
import { BaseSolver } from "../../solvers/BaseSolver"
import { CapacityMeshEdgeSolver } from "../../solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { getColorMap } from "../../solvers/colors"
import { HighDensitySolver } from "../../solvers/HighDensitySolver/HighDensitySolver"
import { SimpleHighDensitySolver } from "./SimpleHighDensitySolver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { CapacityNodeTargetMerger } from "../../solvers/CapacityNodeTargetMerger/CapacityNodeTargetMerger"
import { calculateOptimalCapacityDepth } from "../../utils/getTunedTotalCapacity1"
import { NetToPointPairsSolver } from "../../solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { MultipleHighDensityRouteStitchSolver } from "../../solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { StrawSolver } from "../../solvers/StrawSolver/StrawSolver"
import { SingleLayerNodeMergerSolver } from "../../solvers/SingleLayerNodeMerger/SingleLayerNodeMergerSolver"
import {
  HighDensityIntraNodeRoute,
  HighDensityRoute,
} from "lib/types/high-density-types"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "../../solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { DeadEndSolver } from "../../solvers/DeadEndSolver/DeadEndSolver"
import { CacheProvider } from "lib/cache/types"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { NetToPointPairsSolver2_OffBoardConnection } from "../../solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { RectDiffPipeline } from "@tscircuit/rectdiff"
import { TraceSimplificationSolver } from "../../solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { TraceKeepoutSolver } from "../../solvers/TraceKeepoutSolver/TraceKeepoutSolver"
import { TraceWidthSolver } from "../../solvers/TraceWidthSolver/TraceWidthSolver"
import { AvailableSegmentPointSolver } from "../../solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import {
  PortPointPathingSolver,
  InputNodeWithPortPoints,
  InputPortPoint,
} from "../../solvers/PortPointPathingSolver/PortPointPathingSolver"
import { CapacityMeshNodeSolver2_NodeUnderObstacle } from "../../solvers/CapacityMeshSolver/CapacityMeshNodeSolver2_NodesUnderObstacles"
import { MultiSectionPortPointOptimizer } from "../../solvers/MultiSectionPortPointOptimizer"
import { PortPointOffboardPathFragmentSolver } from "./PortPointOffboardPathFragmentSolver"
import {
  HyperPortPointPathingSolver,
  HyperPortPointPathingSolverParams,
} from "lib/solvers/PortPointPathingSolver/HyperPortPointPathingSolver"
import { RelateNodesToOffBoardConnectionsSolver } from "./RelateNodesToOffBoardConnectionsSolver"
import { updateConnMapWithOffboardObstacleConnections } from "./updateConnMapWithOffboardObstacleConnections"

interface CapacityMeshSolverOptions {
  capacityDepth?: number
  targetMinCapacity?: number
  cacheProvider?: CacheProvider | null
  effort?: number
}
export type AutoroutingPipelineSolverOptions = CapacityMeshSolverOptions

type PipelineStep<T extends new (...args: any[]) => BaseSolver> = {
  solverName: string
  solverClass: T
  getConstructorParams: (
    instance: AssignableAutoroutingPipeline2,
  ) => ConstructorParameters<T>
  onSolved?: (instance: AssignableAutoroutingPipeline2) => void
}

function definePipelineStep<
  T extends new (
    ...args: any[]
  ) => BaseSolver,
  const P extends ConstructorParameters<T>,
>(
  solverName: keyof AssignableAutoroutingPipeline2,
  solverClass: T,
  getConstructorParams: (instance: AssignableAutoroutingPipeline2) => P,
  opts: {
    onSolved?: (instance: AssignableAutoroutingPipeline2) => void
  } = {},
): PipelineStep<T> {
  return {
    solverName,
    solverClass,
    getConstructorParams,
    onSolved: opts.onSolved,
  }
}

export class AssignableAutoroutingPipeline2 extends BaseSolver {
  netToPointPairsSolver?: NetToPointPairsSolver
  // nodeSolver?: CapacityMeshNodeSolver2_NodeUnderObstacle
  nodeSolver?: RectDiffPipeline
  nodeTargetMerger?: CapacityNodeTargetMerger
  edgeSolver?: CapacityMeshEdgeSolver
  relateNodesToOffBoardConnections?: RelateNodesToOffBoardConnectionsSolver
  colorMap: Record<string, string>
  highDensityRouteSolver?: HighDensitySolver
  simpleHighDensityRouteSolver?: SimpleHighDensitySolver
  highDensityStitchSolver?: MultipleHighDensityRouteStitchSolver
  singleLayerNodeMerger?: SingleLayerNodeMergerSolver
  offboardPathFragmentSolver?: PortPointOffboardPathFragmentSolver
  strawSolver?: StrawSolver
  deadEndSolver?: DeadEndSolver
  traceSimplificationSolver?: TraceSimplificationSolver
  traceKeepoutSolver?: TraceKeepoutSolver
  traceWidthSolver?: TraceWidthSolver
  availableSegmentPointSolver?: AvailableSegmentPointSolver
  portPointPathingSolver?: PortPointPathingSolver
  multiSectionPortPointOptimizer?: MultiSectionPortPointOptimizer
  viaDiameter: number
  minTraceWidth: number
  effort: number

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
      NetToPointPairsSolver,
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
      RectDiffPipeline,
      // Cast to any because RectDiffSolver uses an older SimpleRouteJson type
      // that doesn't support MultiLayerConnectionPoint yet
      (cms) => [{ simpleRouteJson: cms.srjWithPointPairs! as any }],
      {
        onSolved: (cms) => {
          cms.capacityNodes = cms.nodeSolver?.getOutput().meshNodes ?? []
        },
      },
    ),
    definePipelineStep(
      "relateNodesToOffBoardConnections",
      RelateNodesToOffBoardConnectionsSolver,
      (cms) => [
        {
          capacityMeshNodes: cms.capacityNodes!,
          srj: cms.srj,
        },
      ],
      {
        onSolved: (cms) => {
          cms.capacityNodes =
            cms.relateNodesToOffBoardConnections?.getOutput().capacityNodes!
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
        },
      ],
    ),
    definePipelineStep(
      "portPointPathingSolver",
      HyperPortPointPathingSolver,
      (cms) => {
        // Convert capacity nodes and segment points to InputNodeWithPortPoints
        const inputNodes: InputNodeWithPortPoints[] = cms.capacityNodes!.map(
          (node) => ({
            capacityMeshNodeId: node.capacityMeshNodeId,
            center: node.center,
            width: node.width,
            height: node.height,
            portPoints: [] as InputPortPoint[],
            availableZ: node.availableZ,
            _containsTarget: node._containsTarget,
            _containsObstacle: node._containsObstacle,
            _offBoardConnectionId: node._offBoardConnectionId,
            _offBoardConnectedCapacityMeshNodeIds:
              node._offBoardConnectedCapacityMeshNodeIds,
          }),
        )

        // Build a map for quick lookup
        const nodeMap = new Map(
          inputNodes.map((n) => [n.capacityMeshNodeId, n]),
        )

        // Add port points from the available segment point solver
        const segmentPointSolver = cms.availableSegmentPointSolver!
        for (const segment of segmentPointSolver.sharedEdgeSegments) {
          for (const segmentPortPoint of segment.portPoints) {
            const [nodeId1, nodeId2] = segmentPortPoint.nodeIds
            const inputPortPoint: InputPortPoint = {
              portPointId: segmentPortPoint.segmentPortPointId,
              x: segmentPortPoint.x,
              y: segmentPortPoint.y,
              z: segmentPortPoint.availableZ[0] ?? 0,
              connectionNodeIds: [nodeId1, nodeId2],
              distToCentermostPortOnZ: segmentPortPoint.distToCentermostPortOnZ,
              connectsToOffBoardNode: segment.nodeIds.some(
                (n) => nodeMap.get(n)?._offBoardConnectionId,
              ),
            }

            // Add to first node
            const node1 = nodeMap.get(nodeId1)
            if (node1) {
              node1.portPoints.push(inputPortPoint)
            }
            // Note: Don't add to second node - the solver will handle the shared edge
          }
        }

        return [
          {
            simpleRouteJson: cms.srjWithPointPairs!,
            inputNodes,
            capacityMeshNodes: cms.capacityNodes!,
            colorMap: cms.colorMap,
            numShuffleSeeds: 10000 * cms.effort,
            minAllowedBoardScore: -1,
            hyperParameters: {
              // 1 = 60% maximum pf (see computeSectionScore)
              // 5 = 99.3% maximum pf
              // 10 = 99.995% maximum pf (1 - e**(-10))
              // NODE_PF_MAX_PENALTY: 10,
              // RANDOM_WALK_DISTANCE: 50,
              NODE_PF_FACTOR: 10000,
              FORCE_OFF_BOARD_FREQUENCY: 0.3,
              CENTER_OFFSET_DIST_PENALTY_FACTOR: 1,
              FORCE_CENTER_FIRST: true,
            },
          } as HyperPortPointPathingSolverParams,
        ]
      },
      {
        onSolved: (cms) => {
          const solver = cms.portPointPathingSolver
          if (!solver) return
          updateConnMapWithOffboardObstacleConnections({
            connMap: cms.connMap,
            connectionsWithResults: solver.connectionsWithResults,
            inputNodes: solver.inputNodes,
            obstacles: cms.srj.obstacles,
          })
        },
      },
    ),
    // definePipelineStep(
    //   "multiSectionPortPointOptimizer",
    //   MultiSectionPortPointOptimizer,
    //   (cms) => {
    //     const portPointSolver = cms.portPointPathingSolver!
    //     return [
    //       {
    //         simpleRouteJson: cms.srjWithPointPairs!,
    //         inputNodes: portPointSolver.inputNodes,
    //         capacityMeshNodes: cms.capacityNodes!,
    //         capacityMeshEdges: cms.capacityEdges!,
    //         colorMap: cms.colorMap,
    //         initialConnectionResults: portPointSolver.connectionsWithResults,
    //         initialAssignedPortPoints: portPointSolver.assignedPortPoints,
    //         initialNodeAssignedPortPoints:
    //           portPointSolver.nodeAssignedPortPoints,
    //       },
    //     ]
    //   },
    // ),
    definePipelineStep(
      "simpleHighDensityRouteSolver",
      SimpleHighDensitySolver,
      (cms) => [
        {
          nodePortPoints:
            cms.portPointPathingSolver?.getNodesWithPortPoints() ??
            cms.multiSectionPortPointOptimizer?.getNodesWithPortPoints() ??
            [],
          colorMap: cms.colorMap,
          viaDiameter: cms.viaDiameter,
          traceWidth: cms.minTraceWidth,
        },
      ],
    ),
    definePipelineStep(
      "highDensityStitchSolver",
      MultipleHighDensityRouteStitchSolver,
      (cms) => [
        {
          connections: cms.srjWithPointPairs!.connections,
          hdRoutes: cms.simpleHighDensityRouteSolver!.routes,
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
          hdRoutes:
            cms.highDensityStitchSolver?.mergedHdRoutes ??
            cms.simpleHighDensityRouteSolver?.routes ??
            cms.highDensityRouteSolver?.routes!,
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
    definePipelineStep("traceKeepoutSolver", TraceKeepoutSolver, (cms) => [
      {
        hdRoutes: cms.traceSimplificationSolver?.simplifiedHdRoutes ?? [],
        obstacles: cms.srj.obstacles,
        connMap: cms.connMap,
        colorMap: cms.colorMap,
        srj: cms.srj,
      },
    ]),
    definePipelineStep("traceWidthSolver", TraceWidthSolver, (cms) => [
      {
        hdRoutes: cms.traceKeepoutSolver?.redrawnHdRoutes ?? [],
        obstacles: cms.srj.obstacles,
        connMap: cms.connMap,
        colorMap: cms.colorMap,
        nominalTraceWidth: cms.srj.nominalTraceWidth,
        minTraceWidth: cms.minTraceWidth,
        obstacleMargin: cms.srj.defaultObstacleMargin ?? 0.15,
      },
    ]),
  ]

  constructor(
    public srj: SimpleRouteJson,
    public opts: CapacityMeshSolverOptions = {},
  ) {
    super()
    this.MAX_ITERATIONS = 100e6
    this.viaDiameter = srj.minViaDiameter ?? 0.6
    this.minTraceWidth = srj.minTraceWidth
    this.effort = opts.effort ?? 1

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
    const availableSegmentPointViz =
      this.availableSegmentPointSolver?.visualize()
    const offboardPathFragmentViz = this.offboardPathFragmentSolver?.visualize()
    const portPointPathingViz = this.portPointPathingSolver?.visualize()
    const multiSectionOptViz = this.multiSectionPortPointOptimizer?.visualize()
    const highDensityViz = this.highDensityRouteSolver?.visualize()
    const simpleHighDensityViz = this.simpleHighDensityRouteSolver?.visualize()
    const highDensityStitchViz = this.highDensityStitchSolver?.visualize()
    const traceSimplificationViz = this.traceSimplificationSolver?.visualize()
    const traceKeepoutViz = this.traceKeepoutSolver?.visualize()
    const traceWidthViz = this.traceWidthSolver?.visualize()
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
          label: [
            "obstacle",
            o.offBoardConnectsTo
              ? `offboardConnections: ${o.offBoardConnectsTo?.join(", ")}`
              : "",
            o.layers?.join(", "),
          ]
            .filter(Boolean)
            .join("\n"),
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
      availableSegmentPointViz,
      offboardPathFragmentViz,
      portPointPathingViz,
      multiSectionOptViz,
      highDensityViz ? combineVisualizations(problemViz, highDensityViz) : null,
      simpleHighDensityViz
        ? combineVisualizations(problemViz, simpleHighDensityViz)
        : null,
      highDensityStitchViz,
      traceSimplificationViz,
      traceKeepoutViz,
      traceWidthViz,
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
    const hdRoutes =
      this.simpleHighDensityRouteSolver?.routes ??
      this.highDensityRouteSolver?.routes
    if (hdRoutes) {
      const lines: Line[] = []
      for (let i = hdRoutes.length - 1; i >= 0; i--) {
        const route = hdRoutes[i]
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
      const lines: Line[] = []
      for (const connection of this.portPointPathingSolver
        .connectionsWithResults) {
        if (!connection.path) continue
        lines.push({
          points: connection.path.map((candidate) => ({
            x: candidate.point.x,
            y: candidate.point.y,
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
      this.traceWidthSolver?.hdRoutesWithWidths ??
      this.traceKeepoutSolver?.redrawnHdRoutes ??
      this.traceSimplificationSolver?.simplifiedHdRoutes ??
      this.highDensityStitchSolver?.mergedHdRoutes ??
      this.simpleHighDensityRouteSolver?.routes ??
      this.highDensityRouteSolver?.routes!
    )
  }

  getConnectedOffboardObstacles(): Record<ObstacleId, RootConnectionName> {
    const connectedOffboardObstacles: Record<ObstacleId, RootConnectionName> =
      {}
    const rootConnectionNames = new Set(
      this.srj.connections.map(
        (connection) => connection.rootConnectionName ?? connection.name,
      ),
    )

    for (const [index, obstacle] of this.srj.obstacles.entries()) {
      if (!obstacle.offBoardConnectsTo?.length) continue
      const obstacleId = obstacle.obstacleId ?? `__obs${index}`
      obstacle.obstacleId = obstacleId

      const netId = this.connMap.getNetConnectedToId(obstacleId)
      if (!netId) continue

      const connectedIds = this.connMap.getIdsConnectedToNet(netId)
      const rootConnectionName = connectedIds.find((id) =>
        rootConnectionNames.has(id),
      )
      if (!rootConnectionName) continue

      connectedOffboardObstacles[obstacleId] = rootConnectionName
    }

    return connectedOffboardObstacles
  }

  /**
   * Returns the SimpleRouteJson with routes converted to SimplifiedPcbTraces
   */
  getOutputSimplifiedPcbTraces(): SimplifiedPcbTraces {
    if (
      !this.solved ||
      (!this.highDensityRouteSolver && !this.simpleHighDensityRouteSolver)
    ) {
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
