import type { LengthConstrainedTraceSolver } from "../../solvers/LengthConstrainedTraceSolver/LengthConstrainedTraceSolver"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import type { Pipeline9EffortCleanupSolver } from "./Pipeline9EffortCleanupSolver"
import type { RectDiffPipeline } from "@tscircuit/rectdiff"
import type { PowerTraceExpanderOptions } from "@tscircuit/power-trace-expander"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject, Line } from "graphics-debug"
import { Pipeline9HighDensityForceImproveSolver } from "./Pipeline9HighDensityForceImproveSolver"
import type { GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import type { CacheProvider } from "lib/cache/types"
import type { ComponentDetectionSolver } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import type { MultiTargetNecessaryCrampedPortPointSolver } from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { MultiGraphTopologyPlannerSolver } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { ClearanceGapIndex } from "./ClearanceGapIndex"
import { findConflictingGaps } from "./findConflictingGaps"
import { splitNodesWithoutThroughViaSite } from "./splitNodesWithoutThroughViaSite"
import type { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { getColorMap } from "lib/solvers/colors"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  SimpleRouteJson,
  SimplifiedPcbTraces,
} from "lib/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { applyNetColorsToGraphicsObject } from "lib/utils/applyNetColorsToGraphicsObject"
import {
  convertSrjToGraphicsObject,
  type TraceColorMode,
} from "lib/utils/convertSrjToGraphicsObject"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { calculateOptimalCapacityDepth } from "lib/utils/getTunedTotalCapacity1"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import type {
  AvailableSegmentPointSolver,
  SharedEdgeSegment,
} from "../../solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { BaseSolver } from "../../solvers/BaseSolver"
import type { CapacityMeshEdgeSolver } from "../../solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import type { CapacityNodeTargetMerger } from "../../solvers/CapacityNodeTargetMerger/CapacityNodeTargetMerger"
import type { DeadEndSolver } from "../../solvers/DeadEndSolver/DeadEndSolver"
import type { EscapeViaLocationSolver } from "../../solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import { Pipeline4HighDensityRepairSolver } from "../../solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { MultiSectionPortPointOptimizer } from "../../solvers/MultiSectionPortPointOptimizer"
import type { NetToPointPairsSolver } from "../../solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { MultipleHighDensityRouteStitchSolver3 } from "../../solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SingleLayerNodeMergerSolver } from "../../solvers/SingleLayerNodeMerger/SingleLayerNodeMergerSolver"
import type { StrawSolver } from "../../solvers/StrawSolver/StrawSolver"
import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import type { TraceWidthSolver } from "../../solvers/TraceWidthSolver/TraceWidthSolver"
import type { LengthMatchingPostProcessingSolver } from "../../solvers/length-matching-post-processing-solver"
import { assignUniquePcbTraceIdsToNewTraces } from "lib/utils/assignUniquePcbTraceIdsToNewTraces"
import { canonicalizePipeline9HdRoutes } from "./canonicalizePipeline9HdRoutes"
import { Pipeline9HighDensitySolver } from "./Pipeline9HighDensitySolver"
import type { Pipeline9JointDrcRepairSolver } from "./Pipeline9JointDrcRepairSolver"
import type { PreloadedTraceGraphSolver } from "./PreloadedTraceGraphSolver"
import { PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver } from "./PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver"
import type { MergedComponentTopologyView } from "../AutoroutingPipeline7_MultiGraph/MergedComponentTopologyView"
import type { PowerTraceExpansionSolver } from "../AutoroutingPipeline7_MultiGraph/PowerTraceExpansionSolver"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "../AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import type { Pipeline7PowerTraceExpansionInput } from "../AutoroutingPipeline7_MultiGraph/prepare-pipeline7-power-trace-expansion-input"
import { definePipeline9Step } from "./definePipeline9Step"
import { getPipeline9PortPointPathingInput } from "./getPipeline9PortPointPathingInput"
import { visualizePipeline9 } from "./visualizePipeline9"
import { pipeline9TopologySteps } from "./pipeline9TopologySteps"
import { pipeline9HighDensitySteps } from "./pipeline9HighDensitySteps"
import { pipeline9TraceRefinementSteps } from "./pipeline9TraceRefinementSteps"
import { pipeline9PostProcessingSteps } from "./pipeline9PostProcessingSteps"
import { getPreloadedTraceUpdatesAfterHighDensity } from "./pipeline9PreloadedTraceUpdates"

interface CapacityMeshSolverOptions {
  capacityDepth?: number
  targetMinCapacity?: number
  cacheProvider?: CacheProvider | null
  effort?: number
  maxNodeDimension?: number
  maxNodeRatio?: number
  minNodeArea?: number
  visualizationTraceColorMode?: TraceColorMode
  /** Retain low-level high-density search history for visualization. */
  captureSearchDebug?: boolean
  powerTraceExpansion?: PowerTraceExpanderOptions
}
export type AutoroutingPipelineSolverOptions = CapacityMeshSolverOptions

export class AutoroutingPipelineSolver9_PreloadedTraceGraph extends BaseSolver {
  override getSolverName(): string {
    return "AutoroutingPipelineSolver9_PreloadedTraceGraph"
  }

  preprocessSimpleRouteJsonSolver?: PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver
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
  highDensityRouteSolver?: Pipeline9HighDensitySolver
  highDensityForceImproveSolver?: Pipeline9HighDensityForceImproveSolver
  highDensityRepairSolver?: Pipeline4HighDensityRepairSolver
  highDensityStitchSolver?: MultipleHighDensityRouteStitchSolver3
  globalDrcForceImproveSolver?: GlobalDrcForceImproveSolver
  pipeline9JointDrcRepairSolver?: Pipeline9JointDrcRepairSolver
  singleLayerNodeMerger?: SingleLayerNodeMergerSolver
  strawSolver?: StrawSolver
  deadEndSolver?: DeadEndSolver
  traceSimplificationSolver?: TraceSimplificationSolver
  mutatedPreloadedTraceSimplificationSolver?: TraceSimplificationSolver
  lengthMatchingPostProcessingSolver?: LengthMatchingPostProcessingSolver
  powerTraceExpansionSolver?: PowerTraceExpansionSolver
  availableSegmentPointSolver?: AvailableSegmentPointSolver
  portPointPathingSolver?: TinyHypergraphPortPointPathingSolver
  multiSectionPortPointOptimizer?: MultiSectionPortPointOptimizer
  uniformPortDistributionSolver?: UniformPortDistributionSolver
  traceWidthSolver?: TraceWidthSolver
  necessaryCrampedPortPointSolver?: MultiTargetNecessaryCrampedPortPointSolver
  preloadedTraceGraphSolver?: PreloadedTraceGraphSolver
  componentDetectionSolver?: ComponentDetectionSolver
  viaDiameter!: number
  viaHoleDiameter!: number
  minTraceWidth!: number
  effort: number
  effortCleanupSolver?: Pipeline9EffortCleanupSolver
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
  lengthConstrainedTraceSolver?: LengthConstrainedTraceSolver
  readonly originalSrj: SimpleRouteJson
  private readonly excludedGaps = new ClearanceGapIndex()
  private hasRefinedFixedWireViaSites = false
  capacityNodes: CapacityMeshNode[] | null = null
  capacityEdges: CapacityMeshEdge[] | null = null
  /** Available segment points after non-component cramped points are filtered. */
  sharedEdgeSegmentsWithNecessaryCrampedPortPoints?: SharedEdgeSegment[]
  highDensityNodePortPoints?: NodeWithPortPoints[]

  cacheProvider: CacheProvider | null = null
  /** Each instance owns its stage definitions so networked routing can replace a stage. */
  pipelineDef = [
    definePipeline9Step({
      solverName: "preprocessSimpleRouteJsonSolver",
      solverClass: PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver,
      getConstructorParams: (pipeline) => [
        pipeline.originalSrj,
        { traceColorMode: pipeline.visualizationTraceColorMode },
      ],
      onSolved: (pipeline) => {
        pipeline.setSimpleRouteJson(
          pipeline.preprocessSimpleRouteJsonSolver!.getOutputSimpleRouteJson(),
        )
      },
    }),
    ...pipeline9TopologySteps,
    definePipeline9Step({
      solverName: "portPointPathingSolver",
      solverClass: TinyHypergraphPortPointPathingSolver,
      getConstructorParams: (pipeline) => {
        const segmentPortPoints =
          pipeline.preloadedTraceGraphSolver!.getRoutablePortPoints(
            pipeline.excludedGaps,
          )
        return [getPipeline9PortPointPathingInput(segmentPortPoints, pipeline)]
      },
    }),
    ...pipeline9HighDensitySteps,
    ...pipeline9TraceRefinementSteps,
    ...pipeline9PostProcessingSteps,
  ].map((step): typeof step => ({ ...step }))

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
    this.maxNodeDimension = mutableOpts.maxNodeDimension ?? 15
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
  private asyncRunning = false

  /** Keep orchestration on the host while independent node work uses its pool. */
  async solveAsync(runtime?: SolverRuntimeExecutor): Promise<void> {
    if (this.asyncRunning)
      throw new Error("Pipeline9 solveAsync is already running")
    const startTime = performance.now()
    let lastYield = startTime
    this.asyncRunning = true
    try {
      if (runtime === undefined) {
        this.solve()
        return
      }
      while (!this.solved && !this.failed) {
        if (
          this.activeSubSolver instanceof Pipeline9HighDensitySolver ||
          this.activeSubSolver instanceof
            TinyHypergraphPortPointPathingSolver ||
          this.activeSubSolver instanceof Pipeline4HighDensityRepairSolver ||
          this.activeSubSolver instanceof Pipeline9HighDensityForceImproveSolver
        ) {
          const phase = this.activeSubSolver
          const previousIterations = phase.iterations
          await phase.solveAsync(
            runtime,
            previousIterations +
              Math.max(0, this.MAX_ITERATIONS - this.iterations),
          )
          const terminal = phase.solved || phase.failed
          this.iterations += Math.max(
            0,
            phase.iterations - previousIterations - (terminal ? 1 : 0),
          )
        }
        this.step()
        if (
          this.iterations % 1024 === 0 &&
          performance.now() - lastYield >= 16
        ) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          lastYield = performance.now()
        }
      }
    } catch (error) {
      this.failed = true
      this.error = `Pipeline9 asynchronous solve error: ${error}`
      throw error
    } finally {
      this.asyncRunning = false
      this.timeToSolve = performance.now() - startTime
    }
  }

  computeProgress(): number {
    const activeSubSolverProgress = this.activeSubSolver?.progress ?? 0
    return (
      (this.currentPipelineStepIndex + activeSubSolverProgress) /
      this.pipelineDef.length
    )
  }

  private refineFixedWireViaSites(
    nodesWithPortPoints: readonly NodeWithPortPoints[],
  ): boolean {
    const layerChangeNodeIds = new Set(
      nodesWithPortPoints
        .filter((node) =>
          node.portPointsInPairs?.some(([entry, exit]) => entry.z !== exit.z),
        )
        .map((node) => node.capacityMeshNodeId),
    )
    const nodes = this.capacityNodes!
    const refined = splitNodesWithoutThroughViaSite({
      nodes,
      layerChangeNodeIds,
      srj: this.srj,
      connMap: this.connMap,
      viaDiameter: this.viaDiameter,
    })
    if (nodes === refined) return false

    // The provisional plan uses a physically impossible via. Rebuild the edges,
    // shared ports and path on the constrained mesh before exposing the plan.
    this.hasRefinedFixedWireViaSites = true
    this.capacityNodes = refined
    return true
  }

  private refinePortPointPlan(): boolean {
    const { clearanceGapsByPortId } = this.preloadedTraceGraphSolver!
    const checkViaSites =
      !this.hasRefinedFixedWireViaSites &&
      this.srj.traces?.some((trace) => trace.isFixed)
    if (!checkViaSites && clearanceGapsByPortId.size < 2) return false

    const { nodesWithPortPoints } = this.portPointPathingSolver!.getOutput()
    if (checkViaSites && this.refineFixedWireViaSites(nodesWithPortPoints)) {
      this.currentPipelineStepIndex = this.pipelineDef.findIndex(
        (step) => step.solverName === "edgeSolver",
      )
    } else {
      const conflictingGaps = findConflictingGaps({
        nodesWithPortPoints,
        clearanceGapsByPortId,
        connMap: this.connMap,
        srj: this.srjWithPointPairs!,
      })
      if (conflictingGaps.length === 0) return false
      for (const gap of conflictingGaps) this.excludedGaps.add(gap)
    }
    this.portPointPathingSolver = undefined
    return true
  }

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
        if (
          pipelineStepDef.solverName === "portPointPathingSolver" &&
          this.refinePortPointPlan()
        ) {
          return
        }
        if (
          pipelineStepDef.solverName === "highDensityRouteSolver" &&
          this.highDensityRouteSolver?.completedBoardRoutes
        ) {
          // The BGA solver returns complete, clearance-checked port-to-port
          // paths. Node stitching and its geometric repairs apply to fragments.
          this.currentPipelineStepIndex = this.pipelineDef.findIndex(
            (step) => step.solverName === "powerTraceExpansionSolver",
          )
          return
        }
        this.currentPipelineStepIndex++
      } else if (this.activeSubSolver.failed) {
        this.error = this.activeSubSolver?.error
        this.failed = true
        this.activeSubSolver = null
      }
      return
    }

    const constructorParams = pipelineStepDef.getConstructorParams(this)
    const activeSubSolver: BaseSolver = Reflect.construct(
      pipelineStepDef.solverClass,
      constructorParams,
    )
    this.activeSubSolver = activeSubSolver
    if (this.activeSubSolver instanceof TraceSimplificationSolver) {
      this.activeSubSolver.MAX_SIMPLIFICATION_PIPELINE_LOOPS = Math.ceil(
        this.activeSubSolver.MAX_SIMPLIFICATION_PIPELINE_LOOPS *
          Math.min(1, this.effort),
      )
    }
    if (
      pipelineStepDef.solverName === "lengthMatchingPostProcessingSolver" ||
      pipelineStepDef.solverName === "powerTraceExpansionSolver" ||
      pipelineStepDef.solverName === "effortCleanupSolver"
    )
      this.MAX_ITERATIONS = Math.max(
        this.MAX_ITERATIONS,
        this.iterations + this.activeSubSolver.MAX_ITERATIONS + 1,
      )
    Object.assign(this, { [pipelineStepDef.solverName]: activeSubSolver })
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

  /** Per-connection solo search compute cost; known once port-point pathing starts. */
  getComputeCostSummary() {
    return this.portPointPathingSolver?.getComputeCostSummary()
  }

  visualize(): GraphicsObject {
    return visualizePipeline9(this)
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
    const completedBoardRoutes =
      this.highDensityRouteSolver?.completedBoardRoutes
    if (completedBoardRoutes) return completedBoardRoutes
    const hasLengthMatchPairs =
      (this.originalSrj.differentialPairs?.length ?? 0) > 0 ||
      (this.originalSrj.buses ?? []).some(
        (bus) => bus.maxLengthSkew !== undefined,
      )
    if (hasLengthMatchPairs && this.lengthMatchingPostProcessingSolver) {
      const { hdRoutes } = this.lengthMatchingPostProcessingSolver.getOutput()
      return hdRoutes
    }
    return (
      (this.effortCleanupSolver?.solved
        ? this.effortCleanupSolver.getOutput()
        : undefined) ??
      this.pipeline9JointDrcRepairSolver?.getOutput() ??
      this.globalDrcForceImproveSolver?.getOutput() ??
      this.traceWidthSolver?.getHdRoutesWithWidths() ??
      this.traceSimplificationSolver?.simplifiedHdRoutes ??
      this.highDensityStitchSolver!.mergedHdRoutes
    )
  }

  getUpdatedPreloadedTraces(): SimplifiedPcbTraces {
    return (
      this.pipeline9JointDrcRepairSolver?.getUpdatedPreloadedTraces() ??
      getPreloadedTraceUpdatesAfterHighDensity(this).updatedPreloadedTraces
    )
  }

  getMutatedPreloadedTraces(): SimplifiedPcbTraces {
    return (
      this.pipeline9JointDrcRepairSolver?.getMutatedPreloadedTraces() ??
      getPreloadedTraceUpdatesAfterHighDensity(this).mutatedPreloadedTraces
    )
  }

  getNewTracesBeforePowerExpansion(): SimplifiedPcbTraces {
    if (!this.highDensityRouteSolver) {
      throw new Error("Cannot get new traces before high-density routing")
    }

    const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: this.netToPointPairsSolver?.newConnections ?? [],
      originalConnections: this.originalSrj.connections,
      hdRoutes: canonicalizePipeline9HdRoutes(this._getOutputHdRoutes()),
      layerCount: this.srj.layerCount,
      obstacles: this.srj.obstacles,
      defaultViaHoleDiameter: this.viaHoleDiameter,
      connMap: this.connMap,
    })
    return assignUniquePcbTraceIdsToNewTraces(
      routedTraces,
      this.srj.traces ?? [],
    )
  }

  private getPowerTraceExpansionFixedTraces(): SimplifiedPcbTraces {
    if (!this.powerTraceExpansionSolver) {
      throw new Error(
        "Pipeline9 invariant violated: solved pipeline is missing the unconditional power-trace expansion solver",
      )
    }
    return (
      this.powerTraceExpansionSolver
        .inputSrj as Pipeline7PowerTraceExpansionInput
    ).fixedTraces
  }

  getOutputSimplifiedPcbTraces(): SimplifiedPcbTraces {
    if (!this.solved) {
      throw new Error("Cannot get output before solving is complete")
    }
    if (!this.powerTraceExpansionSolver) {
      throw new Error(
        "Pipeline9 invariant violated: solved pipeline is missing the unconditional power-trace expansion solver",
      )
    }
    const inputTraceIds = new Set(
      this.originalSrj.traces?.map((trace) => trace.pcb_trace_id),
    )
    return [
      ...this.getPowerTraceExpansionFixedTraces().filter(
        (trace) =>
          trace.__replaces_pcb_trace_id !== undefined ||
          !inputTraceIds.has(trace.pcb_trace_id),
      ),
      ...this.powerTraceExpansionSolver.getOutput(),
    ]
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    if (!this.solved) {
      throw new Error("Cannot get output before solving is complete")
    }
    if (!this.powerTraceExpansionSolver) {
      throw new Error(
        "Pipeline9 invariant violated: solved pipeline is missing the unconditional power-trace expansion solver",
      )
    }
    const traces = [
      ...this.getPowerTraceExpansionFixedTraces(),
      ...this.powerTraceExpansionSolver.getOutput(),
    ]
    return {
      ...this.originalSrj,
      traces,
    }
  }
}
