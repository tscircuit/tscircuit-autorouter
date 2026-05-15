import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import { type CapacityMeshNodeId, getConnectionPointLayers } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import {
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
  type TinyHyperGraphSectionPipelineInput,
  type TinyHyperGraphSectionSolverOptions,
  type TinyHyperGraphSolverOptions,
} from "tiny-hypergraph/lib/index"
import type { HgPortPointPathingSolverParams } from "../hgportpointpathingsolver/types"

type RouteMetadata = {
  connectionId: string
  mutuallyConnectedNetworkId?: string
  simpleRouteConnection?: HgPortPointPathingSolverParams["connections"][number]["simpleRouteConnection"]
}

type SerializedTinyConnection = NonNullable<
  SerializedHyperGraph["connections"]
>[number]
type SerializedTinySolvedRoute = NonNullable<
  SerializedHyperGraph["solvedRoutes"]
>[number]

const TINY_TERMINAL_REGION_SIZE = 1e-6
const TINY_SOLVE_GRAPH_BASE_OPTIONS: TinyHyperGraphSolverOptions = {
  DISTANCE_TO_COST: 0.05,
  RIP_THRESHOLD_START: 0.05,
  RIP_THRESHOLD_END: 0.8,
  RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
}
const TINY_SECTION_SOLVER_BASE_OPTIONS: TinyHyperGraphSectionSolverOptions = {
  DISTANCE_TO_COST: 0.05,
  RIP_THRESHOLD_START: 0.05,
  RIP_THRESHOLD_END: 0.8,
  RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: 6,
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST: Number.POSITIVE_INFINITY,
}

const getEffortScale = (effort: number) => Math.max(effort, 1e-2)

const getTinyViaSizeOptions = (
  minViaPadDiameter?: number,
): Pick<TinyHyperGraphSolverOptions, "minViaPadDiameter"> =>
  Number.isFinite(minViaPadDiameter)
    ? { minViaPadDiameter: minViaPadDiameter }
    : {}

const getTinyHyperGraphSolveGraphOptions = (
  effort: number,
  minViaPadDiameter?: number,
): TinyHyperGraphSolverOptions => {
  const effortScale = getEffortScale(effort)
  return {
    ...TINY_SOLVE_GRAPH_BASE_OPTIONS,
    ...getTinyViaSizeOptions(minViaPadDiameter),
    RIP_THRESHOLD_RAMP_ATTEMPTS: Math.ceil(10 * effortScale),
    MAX_ITERATIONS: Math.ceil(10_000_000 * effortScale),
  }
}

const getTinyHyperGraphSectionSolverOptions = (
  effort: number,
  minViaPadDiameter?: number,
): TinyHyperGraphSectionSolverOptions => {
  const effortScale = getEffortScale(effort)
  return {
    ...TINY_SECTION_SOLVER_BASE_OPTIONS,
    ...getTinyViaSizeOptions(minViaPadDiameter),
    RIP_THRESHOLD_RAMP_ATTEMPTS: Math.ceil(16 * effortScale),
    MAX_ITERATIONS: Math.ceil(1_000_000 * effortScale),
  }
}

const getTinyHyperGraphPipelineInput = (
  serializedHyperGraph: SerializedHyperGraph,
  effort: number,
  minViaPadDiameter?: number,
): TinyHyperGraphSectionPipelineInput => ({
  serializedHyperGraph,
  solveGraphOptions: getTinyHyperGraphSolveGraphOptions(
    effort,
    minViaPadDiameter,
  ),
  sectionSolverOptions: getTinyHyperGraphSectionSolverOptions(
    effort,
    minViaPadDiameter,
  ),
})

const getTinyHyperGraphPipelineMaxIterations = (
  inputProblem: TinyHyperGraphSectionPipelineInput,
) =>
  (inputProblem.solveGraphOptions?.MAX_ITERATIONS ?? 1_000_000) +
  (inputProblem.sectionSolverOptions?.MAX_ITERATIONS ?? 1_000_000) +
  1_000_000

const getRouteConnectionName = (routeMetadata: RouteMetadata) =>
  routeMetadata.simpleRouteConnection?.name ?? routeMetadata.connectionId

const getRouteRootConnectionName = (routeMetadata: RouteMetadata) =>
  routeMetadata.simpleRouteConnection?.rootConnectionName ??
  routeMetadata.mutuallyConnectedNetworkId

const getRoutePoint = (routeMetadata: RouteMetadata, endpointIndex: 0 | 1) =>
  routeMetadata.simpleRouteConnection?.pointsToConnect[endpointIndex]

const getSharedConnectionZ = (params: {
  routeMetadata: RouteMetadata
  endpointIndex: 0 | 1
  fallbackZ: number
  regionAvailableZ: number[]
  layerCount: number
}) => {
  const point = getRoutePoint(params.routeMetadata, params.endpointIndex)
  if (!point) {
    return params.fallbackZ
  }

  const pointZLayers = getConnectionPointLayers(point).map((layerName) =>
    mapLayerNameToZ(layerName, params.layerCount),
  )
  const sharedZ = params.regionAvailableZ.find((z) => pointZLayers.includes(z))
  return sharedZ ?? params.fallbackZ
}

const buildSerializedTinyGraph = (
  params: HgPortPointPathingSolverParams,
): SerializedHyperGraph => {
  const regions: SerializedHyperGraph["regions"] = params.graph.regions.map(
    (region) => ({
      regionId: region.regionId,
      pointIds: region.ports.map((port) => port.d.portId),
      d: region.d,
    }),
  )

  const ports: SerializedHyperGraph["ports"] = params.graph.ports.map(
    (port) => ({
      portId: port.d.portId,
      region1Id: port.region1.regionId,
      region2Id: port.region2.regionId,
      d: port.d,
    }),
  )

  const connections: SerializedTinyConnection[] = params.connections.map(
    (connection) => ({
      connectionId: connection.connectionId,
      mutuallyConnectedNetworkId:
        connection.mutuallyConnectedNetworkId ?? connection.connectionId,
      startRegionId: connection.startRegion.regionId,
      endRegionId: connection.endRegion.regionId,
      simpleRouteConnection: connection.simpleRouteConnection,
    }),
  )

  const solvedRoutes: SerializedTinySolvedRoute[] = []

  for (const connection of params.connections) {
    const routeMetadata: RouteMetadata = {
      connectionId: connection.connectionId,
      mutuallyConnectedNetworkId:
        connection.mutuallyConnectedNetworkId ?? connection.connectionId,
      simpleRouteConnection: connection.simpleRouteConnection,
    }
    const startPoint = getRoutePoint(routeMetadata, 0)
    const endPoint = getRoutePoint(routeMetadata, 1)
    const fallbackStartZ = connection.startRegion.d.availableZ[0] ?? 0
    const fallbackEndZ = connection.endRegion.d.availableZ[0] ?? 0
    const startZ = getSharedConnectionZ({
      routeMetadata,
      endpointIndex: 0,
      fallbackZ: fallbackStartZ,
      regionAvailableZ: connection.startRegion.d.availableZ,
      layerCount: params.layerCount,
    })
    const endZ = getSharedConnectionZ({
      routeMetadata,
      endpointIndex: 1,
      fallbackZ: fallbackEndZ,
      regionAvailableZ: connection.endRegion.d.availableZ,
      layerCount: params.layerCount,
    })

    const startTerminalRegionId = `tiny-terminal:start-region:${connection.connectionId}`
    const endTerminalRegionId = `tiny-terminal:end-region:${connection.connectionId}`
    const startTerminalPortId = `tiny-terminal:start-port:${connection.connectionId}`
    const endTerminalPortId = `tiny-terminal:end-port:${connection.connectionId}`

    regions.push({
      regionId: startTerminalRegionId,
      pointIds: [startTerminalPortId],
      d: {
        capacityMeshNodeId: startTerminalRegionId,
        center: {
          x: startPoint?.x ?? connection.startRegion.d.center.x,
          y: startPoint?.y ?? connection.startRegion.d.center.y,
        },
        width: TINY_TERMINAL_REGION_SIZE,
        height: TINY_TERMINAL_REGION_SIZE,
        availableZ: [startZ],
        _containsTarget: true,
        _tinyTerminal: true,
        _tinyTerminalNetId:
          connection.mutuallyConnectedNetworkId ?? connection.connectionId,
      },
    })

    regions.push({
      regionId: endTerminalRegionId,
      pointIds: [endTerminalPortId],
      d: {
        capacityMeshNodeId: endTerminalRegionId,
        center: {
          x: endPoint?.x ?? connection.endRegion.d.center.x,
          y: endPoint?.y ?? connection.endRegion.d.center.y,
        },
        width: TINY_TERMINAL_REGION_SIZE,
        height: TINY_TERMINAL_REGION_SIZE,
        availableZ: [endZ],
        _containsTarget: true,
        _tinyTerminal: true,
        _tinyTerminalNetId:
          connection.mutuallyConnectedNetworkId ?? connection.connectionId,
      },
    })

    ports.push({
      portId: startTerminalPortId,
      region1Id: connection.startRegion.regionId,
      region2Id: startTerminalRegionId,
      d: {
        portId: startTerminalPortId,
        x: startPoint?.x ?? connection.startRegion.d.center.x,
        y: startPoint?.y ?? connection.startRegion.d.center.y,
        z: startZ,
        distToCentermostPortOnZ: 0,
        _tinyTerminal: true,
      },
    })

    ports.push({
      portId: endTerminalPortId,
      region1Id: connection.endRegion.regionId,
      region2Id: endTerminalRegionId,
      d: {
        portId: endTerminalPortId,
        x: endPoint?.x ?? connection.endRegion.d.center.x,
        y: endPoint?.y ?? connection.endRegion.d.center.y,
        z: endZ,
        distToCentermostPortOnZ: 0,
        _tinyTerminal: true,
      },
    })

    const startRegion = regions.find(
      (region) => region.regionId === connection.startRegion.regionId,
    )
    const endRegion = regions.find(
      (region) => region.regionId === connection.endRegion.regionId,
    )
    startRegion?.pointIds.push(startTerminalPortId)
    endRegion?.pointIds.push(endTerminalPortId)

    solvedRoutes.push({
      connection: {
        connectionId: connection.connectionId,
      },
      path: [{ portId: startTerminalPortId }, { portId: endTerminalPortId }],
    } as SerializedTinySolvedRoute)
  }

  return {
    regions,
    ports,
    connections,
    solvedRoutes,
  } satisfies SerializedHyperGraph
}

const applyTerminalRegionNetIds = (loaded: {
  topology: { regionMetadata?: any[] }
  problem: {
    routeMetadata?: any[]
    routeNet: Int32Array
    regionNetId: Int32Array
  }
}) => {
  const netIndexById = new Map<string, number>()
  for (let routeId = 0; routeId < loaded.problem.routeNet.length; routeId++) {
    const routeMetadata = loaded.problem.routeMetadata?.[routeId]
    const netId =
      routeMetadata?.mutuallyConnectedNetworkId ?? routeMetadata?.connectionId
    if (typeof netId === "string") {
      netIndexById.set(netId, loaded.problem.routeNet[routeId]!)
    }
  }

  for (
    let regionIndex = 0;
    regionIndex < loaded.problem.regionNetId.length;
    regionIndex++
  ) {
    const terminalNetId =
      loaded.topology.regionMetadata?.[regionIndex]?._tinyTerminalNetId
    if (typeof terminalNetId !== "string") {
      continue
    }
    const netIndex = netIndexById.get(terminalNetId)
    if (netIndex === undefined) {
      continue
    }
    loaded.problem.regionNetId[regionIndex] = netIndex
  }
}

class TinyHyperGraphSectionPipelineWithTerminalNetIds extends TinyHyperGraphSectionPipelineSolver {
  private configuredSolvers = new WeakSet<BaseSolver>()

  constructor(inputProblem: TinyHyperGraphSectionPipelineInput) {
    super(inputProblem)
    this.MAX_ITERATIONS = getTinyHyperGraphPipelineMaxIterations(inputProblem)
  }

  override _step() {
    try {
      super._step()
    } catch (error) {
      if (this.tryAcceptSolveGraphWithoutSerializedOutput(error)) {
        return
      }
      if (this.trySkipOptimizeSection(error)) {
        return
      }
      throw error
    }
    this.configureSolver(this.activeSubSolver)
  }

  override getInitialVisualizationSolver() {
    const solver = super.getInitialVisualizationSolver()
    this.configureSolver(solver)
    return solver
  }

  getSolvedTinySolver(): TinyHyperGraphSolver {
    const optimizeSectionSolver =
      this.getSolver<TinyHyperGraphSectionSolver>("optimizeSection")

    if (optimizeSectionSolver?.solved && !optimizeSectionSolver.failed) {
      return optimizeSectionSolver.getSolvedSolver()
    }

    const solveGraphSolver = this.getSolver<TinyHyperGraphSolver>("solveGraph")
    if (solveGraphSolver?.solved && !solveGraphSolver.failed) {
      return solveGraphSolver
    }

    throw new Error(
      "TinyHyperGraph section pipeline does not have a solved graph",
    )
  }

  private configureSolver(solver?: BaseSolver | null) {
    if (!solver || this.configuredSolvers.has(solver)) {
      return
    }

    if (
      solver instanceof TinyHyperGraphSectionSolver ||
      solver instanceof TinyHyperGraphSolver
    ) {
      applyTerminalRegionNetIds(solver as any)
    }

    this.configuredSolvers.add(solver)
  }

  private trySkipOptimizeSection(error: unknown) {
    if (this.getCurrentStageName() !== "optimizeSection") {
      return false
    }

    const solveGraphOutput =
      this.getStageOutput<SerializedHyperGraph>("solveGraph")

    if (!solveGraphOutput) {
      return false
    }

    this.pipelineOutputs.optimizeSection = solveGraphOutput
    this.finishWithExistingSolverState({
      sectionOptimizationSkipped: true,
      sectionOptimizationError:
        error instanceof Error ? error.message : String(error),
    })
    return true
  }

  private tryAcceptSolveGraphWithoutSerializedOutput(error: unknown) {
    if (this.getCurrentStageName() !== "solveGraph") {
      return false
    }

    const solveGraphSolver = this.getSolver<TinyHyperGraphSolver>("solveGraph")
    if (!solveGraphSolver?.solved || solveGraphSolver.failed) {
      return false
    }

    this.finishWithExistingSolverState({
      solveGraphSerializationSkipped: true,
      sectionOptimizationSkipped: true,
      sectionOptimizationError:
        error instanceof Error ? error.message : String(error),
    })
    return true
  }

  private finishWithExistingSolverState(extraStats: Record<string, unknown>) {
    this.currentPipelineStageIndex = this.pipelineDef.length
    this.activeSubSolver = null
    this.solved = true
    this.failed = false
    this.error = null
    this.stats = {
      ...this.stats,
      ...extraStats,
    }
  }
}

export class TinyHypergraphPortPointPathingSolver extends BaseSolver {
  private tinyPipelineSolver: TinyHyperGraphSectionPipelineWithTerminalNetIds
  private inputNodeWithPortPoints: InputNodeWithPortPoints[]
  private originalRegionById: Map<
    CapacityMeshNodeId,
    HgPortPointPathingSolverParams["graph"]["regions"][number]
  >
  private originalRegionIds: Set<CapacityMeshNodeId>

  constructor(private params: HgPortPointPathingSolverParams) {
    super()
    const serializedGraph = buildSerializedTinyGraph(params)
    const tinyPipelineInput = getTinyHyperGraphPipelineInput(
      serializedGraph,
      params.effort,
      params.minViaPadDiameter,
    )
    this.tinyPipelineSolver =
      new TinyHyperGraphSectionPipelineWithTerminalNetIds(tinyPipelineInput)
    this.MAX_ITERATIONS =
      getTinyHyperGraphPipelineMaxIterations(tinyPipelineInput)

    this.originalRegionById = new Map(
      params.graph.regions.map((region) => [region.regionId, region]),
    )
    this.originalRegionIds = new Set(this.originalRegionById.keys())
    this.inputNodeWithPortPoints = params.graph.regions.map((region) => ({
      capacityMeshNodeId: region.d.capacityMeshNodeId,
      center: region.d.center,
      width: region.d.width,
      height: region.d.height,
      portPoints: region.ports.map((port) => {
        const connectsToOffBoardNode = port.d.regions.some((candidateRegion) =>
          Boolean(candidateRegion.d._offBoardConnectionId),
        )

        return {
          portPointId: port.d.portId,
          x: port.d.x,
          y: port.d.y,
          z: port.d.z,
          connectionNodeIds: port.d.regions.map(
            (candidateRegion) => candidateRegion.regionId,
          ) as [CapacityMeshNodeId, CapacityMeshNodeId],
          distToCentermostPortOnZ: port.d.distToCentermostPortOnZ,
          connectsToOffBoardNode,
        } satisfies InputPortPoint
      }),
      availableZ: region.d.availableZ,
      _containsObstacle: region.d._containsObstacle,
      _containsTarget: region.d._containsTarget,
      _offBoardConnectionId: region.d._offBoardConnectionId,
      _offBoardConnectedCapacityMeshNodeIds:
        region.d._offBoardConnectedCapacityMeshNodeIds,
    }))
  }

  getSolverName(): string {
    return "TinyHypergraphPortPointPathingSolver"
  }

  _step() {
    try {
      this.tinyPipelineSolver.step()
    } catch (error) {
      this.error = `${this.getSolverName()} error: ${error}`
      this.failed = true
      throw error
    }

    const optimizeSectionSolver =
      this.tinyPipelineSolver.getSolver<TinyHyperGraphSectionSolver>(
        "optimizeSection",
      )
    const currentTinySolver = this.getCurrentTinySolver()

    this.solved = this.tinyPipelineSolver.solved
    this.failed = this.tinyPipelineSolver.failed
    this.error = this.tinyPipelineSolver.error ?? null
    this.progress = this.tinyPipelineSolver.progress
    this.stats = {
      ...(this.tinyPipelineSolver.stats ?? {}),
      ...(currentTinySolver?.stats ?? {}),
      ...(optimizeSectionSolver?.stats ?? {}),
      currentStage: this.tinyPipelineSolver.getCurrentStageName(),
      stageStats: this.tinyPipelineSolver.getStageStats(),
    }
    this.activeSubSolver = this.tinyPipelineSolver.activeSubSolver ?? null
  }

  preview(): GraphicsObject {
    return this.visualize()
  }

  private getCurrentTinySolver(): TinyHyperGraphSolver | undefined {
    const optimizeSectionSolver =
      this.tinyPipelineSolver.getSolver<TinyHyperGraphSectionSolver>(
        "optimizeSection",
      )

    if (optimizeSectionSolver?.solved && !optimizeSectionSolver.failed) {
      return optimizeSectionSolver.getSolvedSolver()
    }

    const solveGraphSolver =
      this.tinyPipelineSolver.getSolver<TinyHyperGraphSolver>("solveGraph")

    if (solveGraphSolver) {
      return solveGraphSolver
    }

    return undefined
  }

  private getSolvedTinySolver(): TinyHyperGraphSolver {
    return this.tinyPipelineSolver.getSolvedTinySolver()
  }

  private getRouteMetadata(
    solvedTinySolver: TinyHyperGraphSolver,
    routeId: number,
  ): RouteMetadata | undefined {
    return solvedTinySolver.problem.routeMetadata?.[routeId] as
      | RouteMetadata
      | undefined
  }

  private createAssignedPortPoint(
    solvedTinySolver: TinyHyperGraphSolver,
    routeId: number,
    portId: number,
  ): PortPoint {
    const routeMetadata = this.getRouteMetadata(solvedTinySolver, routeId)
    const connectionName = routeMetadata
      ? getRouteConnectionName(routeMetadata)
      : `route-${routeId}`
    const rootConnectionName = routeMetadata
      ? getRouteRootConnectionName(routeMetadata)
      : undefined
    const portMetadata = solvedTinySolver.topology.portMetadata?.[portId]

    return {
      portPointId: String(portMetadata?.portId ?? `tiny-port-${portId}`),
      x: solvedTinySolver.topology.portX[portId],
      y: solvedTinySolver.topology.portY[portId],
      z: solvedTinySolver.topology.portZ[portId],
      connectionName,
      rootConnectionName,
    }
  }

  getOutput(): {
    nodesWithPortPoints: NodeWithPortPoints[]
    inputNodeWithPortPoints: InputNodeWithPortPoints[]
  } {
    const solvedTinySolver = this.getSolvedTinySolver()
    const nodesWithPortPoints: NodeWithPortPoints[] = []
    const regionSegments = solvedTinySolver.state.regionSegments
    const regionMetadata = solvedTinySolver.topology.regionMetadata ?? []

    for (let regionId = 0; regionId < regionSegments.length; regionId++) {
      const originalRegionId = regionMetadata[regionId]?.capacityMeshNodeId
      if (!originalRegionId || !this.originalRegionIds.has(originalRegionId)) {
        continue
      }

      const originalRegion = this.originalRegionById.get(originalRegionId)
      if (!originalRegion) continue

      const portPoints = regionSegments[regionId].flatMap(
        ([routeId, fromPortId, toPortId]) =>
          [
            this.createAssignedPortPoint(solvedTinySolver, routeId, fromPortId),
            this.createAssignedPortPoint(solvedTinySolver, routeId, toPortId),
          ] satisfies PortPoint[],
      )

      if (portPoints.length === 0) {
        continue
      }

      nodesWithPortPoints.push({
        capacityMeshNodeId: originalRegion.d.capacityMeshNodeId,
        center: originalRegion.d.center,
        width: originalRegion.d.width,
        height: originalRegion.d.height,
        portPoints,
        availableZ: originalRegion.d.availableZ,
      })
    }

    return {
      nodesWithPortPoints,
      inputNodeWithPortPoints: this.inputNodeWithPortPoints,
    }
  }

  computeNodePf(node: InputNodeWithPortPoints): number | null {
    const solvedNode = this.getOutput().nodesWithPortPoints.find(
      (candidate) => candidate.capacityMeshNodeId === node.capacityMeshNodeId,
    )
    const originalRegion = this.originalRegionById.get(node.capacityMeshNodeId)

    if (!solvedNode || !originalRegion) {
      return null
    }

    const crossings = getIntraNodeCrossingsUsingCircle(solvedNode)

    return calculateNodeProbabilityOfFailure(
      originalRegion.d,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )
  }

  tryFinalAcceptance() {}

  getConstructorParams() {
    return [this.params] as const
  }

  visualize(): GraphicsObject {
    return this.tinyPipelineSolver.visualize()
  }
}
