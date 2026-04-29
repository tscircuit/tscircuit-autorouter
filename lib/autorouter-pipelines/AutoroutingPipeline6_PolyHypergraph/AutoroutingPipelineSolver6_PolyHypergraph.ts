import { GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject, Line } from "graphics-debug"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { CacheProvider } from "lib/cache/types"
import { EscapeViaLocationSolver } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { getColorMap } from "lib/solvers/colors"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
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
import { AttachProjectedRectsSolver } from "./AttachProjectedRectsSolver"
import { PolyHighDensitySolver } from "./PolyHighDensitySolver"
import { PolyHypergraphPortPointPathingSolver } from "./PolyHypergraphPortPointPathingSolver"
import { ProjectHighDensityToPolygonSolver } from "./ProjectHighDensityToPolygonSolver"
import type { PolyNodeWithPortPoints } from "./types"

interface CapacityMeshSolverOptions {
  capacityDepth?: number
  targetMinCapacity?: number
  cacheProvider?: CacheProvider | null
  effort?: number
  maxNodeDimension?: number
  maxNodeRatio?: number
  minNodeArea?: number
  equivalentAreaExpansionFactor?: number
  minProjectedRectDimension?: number
  polyConcavityTolerance?: number
  polyPortSpacing?: number
  polyPortMarginFromSegmentEndpoint?: number
}

export type AutoroutingPipelineSolver6Options = CapacityMeshSolverOptions

type PipelineStep<T extends new (...args: any[]) => BaseSolver> = {
  solverName: string
  solverClass: T
  getConstructorParams: (
    instance: AutoroutingPipelineSolver6_PolyHypergraph,
  ) => ConstructorParameters<T>
  onSolved?: (instance: AutoroutingPipelineSolver6_PolyHypergraph) => void
}

function definePipelineStep<
  T extends new (
    ...args: any[]
  ) => BaseSolver,
  const P extends ConstructorParameters<T>,
>(
  solverName: keyof AutoroutingPipelineSolver6_PolyHypergraph,
  solverClass: T,
  getConstructorParams: (
    instance: AutoroutingPipelineSolver6_PolyHypergraph,
  ) => P,
  opts: {
    onSolved?: (instance: AutoroutingPipelineSolver6_PolyHypergraph) => void
  } = {},
): PipelineStep<T> {
  return {
    solverName,
    solverClass,
    getConstructorParams,
    onSolved: opts.onSolved,
  }
}

export class AutoroutingPipelineSolver6_PolyHypergraph extends BaseSolver {
  escapeViaLocationSolver?: EscapeViaLocationSolver
  netToPointPairsSolver?: NetToPointPairsSolver
  polyGraphSolver?: PolyHypergraphPortPointPathingSolver
  attachProjectedRectsSolver?: AttachProjectedRectsSolver
  highDensityRouteSolver?: PolyHighDensitySolver
  projectHighDensityToPolgonSolver?: ProjectHighDensityToPolygonSolver
  highDensityStitchSolver?: MultipleHighDensityRouteStitchSolver3
  traceSimplificationSolver?: TraceSimplificationSolver
  traceWidthSolver?: TraceWidthSolver
  globalDrcForceImproveSolver?: GlobalDrcForceImproveSolver

  colorMap: Record<string, string>
  viaDiameter: number
  viaHoleDiameter: number
  minTraceWidth: number
  effort: number
  maxNodeDimension: number
  maxNodeRatio: number
  minNodeArea: number
  equivalentAreaExpansionFactor: number
  minProjectedRectDimension: number

  startTimeOfPhase: Record<string, number>
  endTimeOfPhase: Record<string, number>
  timeSpentOnPhase: Record<string, number>

  activeSubSolver?: BaseSolver | null = null
  connMap: ConnectivityMap
  srjWithEscapeViaLocations?: SimpleRouteJson
  srjWithPointPairs?: SimpleRouteJson
  highDensityNodePortPoints?: PolyNodeWithPortPoints[]
  projectedHighDensityNodePortPoints?: PolyNodeWithPortPoints[]

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
          cms.colorMap = getColorMap(cms.srjWithPointPairs!, cms.connMap)
          cms.connMap = getConnectivityMapFromSimpleRouteJson(
            cms.srjWithPointPairs!,
          )
        },
      },
    ),
    definePipelineStep(
      "polyGraphSolver",
      PolyHypergraphPortPointPathingSolver,
      (cms) => [
        {
          srj: cms.srjWithPointPairs!,
          effort: cms.effort,
          concavityTolerance: cms.opts.polyConcavityTolerance,
          portSpacing: cms.opts.polyPortSpacing,
          portMarginFromSegmentEndpoint:
            cms.opts.polyPortMarginFromSegmentEndpoint,
        },
      ],
      {
        onSolved: (cms) => {
          cms.highDensityNodePortPoints =
            cms.polyGraphSolver?.getOutput().nodesWithPortPoints ?? []
        },
      },
    ),
    definePipelineStep(
      "attachProjectedRectsSolver",
      AttachProjectedRectsSolver,
      (cms) => [
        {
          nodesWithPortPoints: cms.highDensityNodePortPoints ?? [],
          equivalentAreaExpansionFactor: cms.equivalentAreaExpansionFactor,
          minProjectedRectDimension: cms.minProjectedRectDimension,
        },
      ],
      {
        onSolved: (cms) => {
          cms.projectedHighDensityNodePortPoints =
            cms.attachProjectedRectsSolver?.getOutput() ?? []
        },
      },
    ),
    definePipelineStep(
      "highDensityRouteSolver",
      PolyHighDensitySolver,
      (cms) => [
        {
          nodePortPoints: cms.projectedHighDensityNodePortPoints ?? [],
          nodePfById: new Map(
            (
              cms.polyGraphSolver?.getOutput().inputNodeWithPortPoints ?? []
            ).map((node) => [
              node.capacityMeshNodeId,
              cms.polyGraphSolver?.computeNodePf(node) ?? null,
            ]),
          ),
          colorMap: cms.colorMap,
          connMap: cms.connMap,
          viaDiameter: cms.viaDiameter,
          traceWidth: cms.minTraceWidth,
          obstacleMargin: cms.srj.defaultObstacleMargin ?? 0.15,
          effort: cms.effort,
        },
      ],
    ),
    definePipelineStep(
      "projectHighDensityToPolgonSolver",
      ProjectHighDensityToPolygonSolver,
      (cms) => [
        {
          nodePortPoints: cms.projectedHighDensityNodePortPoints ?? [],
          routesByNodeId: cms.highDensityRouteSolver!.routesByNodeId,
          colorMap: cms.colorMap,
        },
      ],
    ),
    definePipelineStep(
      "highDensityStitchSolver",
      MultipleHighDensityRouteStitchSolver3,
      (cms) => [
        {
          connections: cms.srjWithPointPairs!.connections,
          hdRoutes: cms.projectHighDensityToPolgonSolver!.routes,
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
    this.equivalentAreaExpansionFactor =
      mutableOpts.equivalentAreaExpansionFactor ?? 2
    this.minProjectedRectDimension =
      mutableOpts.minProjectedRectDimension ?? this.minTraceWidth * 3

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
    this.activeSubSolver = new (pipelineStepDef.solverClass as any)(
      ...constructorParams,
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

  private getProblemVisualization(): GraphicsObject {
    const problemLines: Line[] = [
      {
        points: [
          { x: this.srj.bounds?.minX ?? -50, y: this.srj.bounds?.minY ?? -50 },
          { x: this.srj.bounds?.maxX ?? 50, y: this.srj.bounds?.minY ?? -50 },
          { x: this.srj.bounds?.maxX ?? 50, y: this.srj.bounds?.maxY ?? 50 },
          { x: this.srj.bounds?.minX ?? -50, y: this.srj.bounds?.maxY ?? 50 },
          { x: this.srj.bounds?.minX ?? -50, y: this.srj.bounds?.minY ?? -50 },
        ],
        strokeColor: "rgba(255,0,0,0.25)",
      },
    ]

    if (this.srj.outline && this.srj.outline.length >= 2) {
      const outlinePoints = this.srj.outline.map((point) => ({
        x: point.x,
        y: point.y,
      }))
      outlinePoints.push({ ...outlinePoints[0]! })
      problemLines.push({
        points: outlinePoints,
        strokeColor: "rgba(0, 136, 255, 0.95)",
      })
    }

    const formatObstacleLabel = createObstacleLabelFormatter(this.srj)
    return {
      points: [
        ...this.srj.connections.flatMap((connection) =>
          connection.pointsToConnect.map((point) => ({
            ...point,
            layer: getGraphicsLayerForConnectionPoint(
              point,
              this.srj.layerCount,
            ),
            label: `${connection.name} ${point.pcb_port_id ?? ""}`,
          })),
        ),
      ],
      rects: [
        ...(this.srj.obstacles ?? [])
          .filter((obstacle) => !obstacle.isCopperPour)
          .map((obstacle) => ({
            ...obstacle,
            fill: obstacle.layers?.includes("top")
              ? "rgba(255,0,0,0.25)"
              : obstacle.layers?.includes("bottom")
                ? "rgba(0,0,255,0.25)"
                : "rgba(255,0,0,0.25)",
            layer: getGraphicsLayerForObstacle(obstacle, this.srj.layerCount),
            label: formatObstacleLabel(obstacle),
          })),
      ],
      lines: problemLines,
    }
  }

  visualize(): GraphicsObject {
    if (!this.solved && this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }

    const problemViz = this.getProblemVisualization()
    const polyGraphViz = this.polyGraphSolver?.visualize()
    const projectedRectViz = this.attachProjectedRectsSolver?.visualize()
    const highDensityViz = this.highDensityRouteSolver?.visualize()
    const projectHighDensityToPolygonViz =
      this.projectHighDensityToPolgonSolver?.visualize()
    const highDensityStitchViz = this.highDensityStitchSolver?.visualize()
    const traceSimplificationViz = this.traceSimplificationSolver?.visualize()

    return combineVisualizations(
      ...([
        problemViz,
        this.escapeViaLocationSolver?.visualize(),
        this.netToPointPairsSolver?.visualize(),
        polyGraphViz,
        projectedRectViz,
        highDensityViz
          ? combineVisualizations(problemViz, highDensityViz)
          : null,
        projectHighDensityToPolygonViz
          ? combineVisualizations(problemViz, projectHighDensityToPolygonViz)
          : null,
        highDensityStitchViz,
        traceSimplificationViz,
        this.solved
          ? combineVisualizations(
              problemViz,
              convertSrjToGraphicsObject(this.getOutputSimpleRouteJson()),
            )
          : null,
      ].filter(Boolean) as GraphicsObject[]),
    )
  }

  preview(): GraphicsObject {
    if (this.projectHighDensityToPolgonSolver) {
      const lines: Line[] = []
      for (
        let i = this.projectHighDensityToPolgonSolver.routes.length - 1;
        i >= 0;
        i--
      ) {
        const route = this.projectHighDensityToPolgonSolver.routes[i]
        lines.push({
          points: route.route.map((point) => ({
            x: point.x,
            y: point.y,
          })),
          strokeColor: this.colorMap[route.connectionName],
        })
        if (lines.length > 200) break
      }
      return { lines }
    }

    if (this.highDensityRouteSolver) {
      const lines: Line[] = []
      for (let i = this.highDensityRouteSolver.routes.length - 1; i >= 0; i--) {
        const route = this.highDensityRouteSolver.routes[i]
        lines.push({
          points: route.route.map((point) => ({
            x: point.x,
            y: point.y,
          })),
          strokeColor: this.colorMap[route.connectionName],
        })
        if (lines.length > 200) break
      }
      return { lines }
    }

    if (this.polyGraphSolver) {
      return this.polyGraphSolver.preview()
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
        (route) => route.connectionName === connection.name,
      )

      for (let i = 0; i < hdRoutes.length; i++) {
        const hdRoute = hdRoutes[i]!
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
  AutoroutingPipelineSolver6_PolyHypergraph as AutoroutingPipelineSolver6,
}
