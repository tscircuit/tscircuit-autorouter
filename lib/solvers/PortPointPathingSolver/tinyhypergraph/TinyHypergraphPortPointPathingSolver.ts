import type {
  SerializedConnection,
  SerializedGraphPort,
  SerializedGraphRegion,
  SerializedHyperGraph,
  SerializedSolvedRoute,
} from "@tscircuit/hypergraph"
import {
  BasePipelineSolver,
  BaseSolver,
  definePipelineStep,
} from "@tscircuit/solver-utils"
import type { PipelineStep } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import {
  type CapacityMeshNodeId,
  type SimpleRouteConnection,
  getConnectionPointLayers,
} from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import {
  DuplicateCongestedPortSolver,
  type DuplicateCongestedPortSolverReport,
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
  type TinyHyperGraphSectionPipelineInput,
  type TinyHyperGraphSectionSolverOptions,
  type TinyHyperGraphSolverOptions,
} from "tiny-hypergraph/lib/index"
import type {
  HgPortPointPathingSolverParams,
  RegionHg,
  RegionPortHg,
} from "../hgportpointpathingsolver/types"

type RouteMetadata = {
  connectionId: string
  mutuallyConnectedNetworkId?: string
  simpleRouteConnection?: SimpleRouteConnection
}

type TinyBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type TinyRegionMetadata = {
  bounds?: TinyBounds
  _qfpRegionType?: InputNodeWithPortPoints["_qfpRegionType"]
  _isNarrowQfpPadGap?: boolean
  _offBoardConnectionId?: string
}

type TinyPortMetadata = {
  x?: number
  y?: number
  z?: number
  prevPortPointId?: string
  nextPortPointId?: string
  distToCentermostPortOnZ?: number
  cramped?: boolean
  _tinyTerminal?: boolean
  tinyHypergraphPortPenalty?: number
  duplicatedFromPortId?: string
}

type LoadedTinyGraph = {
  topology: {
    portCount: number
    portMetadata?: TinyPortMetadata[]
    regionMetadata?: Array<TinyRegionMetadata & { _tinyTerminalNetId?: string }>
  }
  problem: {
    routeMetadata?: RouteMetadata[]
    routeNet: Int32Array
    regionNetId: Int32Array
    portPenalty?: Float64Array
    metadataPortPenaltiesApplied?: boolean
  }
}

type DuplicateCongestedPortPrepassSolverInput = {
  serializedHyperGraph: SerializedHyperGraph
  connectionCount: number
  effort: number
  minViaPadDiameter?: number
}

type DuplicateCongestedPortPrepassSolverOutput = {
  serializedHyperGraph: SerializedHyperGraph
  report?: DuplicateCongestedPortSolverReport
  error?: string
  skipped: boolean
  duplicatedPortCount: number
}

const asTinyRegionMetadata = (metadata: unknown): TinyRegionMetadata =>
  typeof metadata === "object" && metadata !== null
    ? (metadata as TinyRegionMetadata)
    : {}

const asTinyPortMetadata = (metadata: unknown): TinyPortMetadata =>
  typeof metadata === "object" && metadata !== null
    ? (metadata as TinyPortMetadata)
    : {}

const TINY_TERMINAL_REGION_SIZE = 1e-6
const TINY_SOLVE_GRAPH_BASE_OPTIONS: TinyHyperGraphSolverOptions = {
  DISTANCE_TO_COST: 0.05,
  RIP_THRESHOLD_START: 0.05,
  RIP_THRESHOLD_END: 0.8,
  RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
  ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
  GREEDY_FINAL_ROUTE_ITERS: 4,
}
const TINY_SECTION_SOLVER_BASE_OPTIONS: TinyHyperGraphSectionSolverOptions = {
  DISTANCE_TO_COST: 0.05,
  RIP_THRESHOLD_START: 0.05,
  RIP_THRESHOLD_END: 0.8,
  RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
  ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
  GREEDY_FINAL_ROUTE_ITERS: 4,
  MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: 6,
  EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST: Number.POSITIVE_INFINITY,
}
const DUPLICATE_PORT_TRAVERSAL_PENALTY = 150
const CRAMPED_PORT_TRAVERSAL_PENALTY = 150
const MAX_CONNECTIONS_FOR_DUPLICATE_CONGESTED_PORT_PREPASS = 180
const DUPLICATE_CONGESTED_PORT_PREPASS_OVERHEAD_ITERATIONS = 2
// Outer pipeline overhead: create prepass, run prepass, create tiny pipeline,
// then mark the outer pipeline solved after the tiny pipeline completes.
const OUTER_PIPELINE_STAGE_OVERHEAD_ITERATIONS = 4

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
    USE_SPARSE_CANDIDATE_STORAGE: true,
    RIP_THRESHOLD_RAMP_ATTEMPTS: Math.ceil(10 * effortScale),
    MAX_ITERATIONS: Math.ceil(2_000_000 * effortScale),
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
    USE_SPARSE_CANDIDATE_STORAGE: true,
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
  createSectionMask: ({ topology }) => new Int8Array(topology.portCount),
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

const toSerializedRegionData = (region: RegionHg) => {
  const regionMetadata = region.d as typeof region.d & TinyRegionMetadata
  const bounds = regionMetadata.bounds

  return {
    capacityMeshNodeId: region.d.capacityMeshNodeId,
    center: {
      x: region.d.center.x,
      y: region.d.center.y,
    },
    width: region.d.width,
    height: region.d.height,
    availableZ: [...region.d.availableZ],
    ...(bounds
      ? {
          bounds: {
            minX: bounds.minX,
            maxX: bounds.maxX,
            minY: bounds.minY,
            maxY: bounds.maxY,
          },
        }
      : {}),
    _containsObstacle: region.d._containsObstacle,
    _containsTarget: region.d._containsTarget,
    _offBoardConnectionId: region.d._offBoardConnectionId,
    _offBoardConnectedCapacityMeshNodeIds:
      region.d._offBoardConnectedCapacityMeshNodeIds === undefined
        ? undefined
        : [...region.d._offBoardConnectedCapacityMeshNodeIds],
    _qfpRegionType: regionMetadata._qfpRegionType,
    _isNarrowQfpPadGap: regionMetadata._isNarrowQfpPadGap,
  }
}

const toSerializedPortData = (port: RegionPortHg) => {
  const portMetadata = port.d as typeof port.d & TinyPortMetadata
  return {
    portId: port.d.portId,
    x: port.d.x,
    y: port.d.y,
    z: port.d.z,
    prevPortPointId: portMetadata.prevPortPointId,
    nextPortPointId: portMetadata.nextPortPointId,
    distToCentermostPortOnZ: port.d.distToCentermostPortOnZ,
    tinyHypergraphPortPenalty: port.d.tinyHypergraphPortPenalty,
    cramped: port.d.cramped,
  }
}

const buildSerializedTinyGraph = (
  params: HgPortPointPathingSolverParams,
): SerializedHyperGraph => {
  const regions: SerializedGraphRegion[] = params.graph.regions.map(
    (region) => ({
      regionId: region.regionId,
      pointIds: region.ports.map((port) => port.d.portId),
      d: toSerializedRegionData(region),
    }),
  )

  const ports: SerializedGraphPort[] = params.graph.ports.map((port) => ({
    portId: port.d.portId,
    region1Id: port.region1.regionId,
    region2Id: port.region2.regionId,
    d: toSerializedPortData(port),
  }))

  const connections: SerializedConnection[] = params.connections.map(
    (connection) => ({
      connectionId: connection.connectionId,
      mutuallyConnectedNetworkId:
        connection.mutuallyConnectedNetworkId ?? connection.connectionId,
      startRegionId: connection.startRegion.regionId,
      endRegionId: connection.endRegion.regionId,
      simpleRouteConnection: connection.simpleRouteConnection,
    }),
  )

  const solvedRoutes: SerializedSolvedRoute[] = []
  const netIndexById = new Map<string, number>()
  const getNetIndex = (routeMetadata: RouteMetadata) => {
    const netId =
      routeMetadata.mutuallyConnectedNetworkId ?? routeMetadata.connectionId
    let netIndex = netIndexById.get(netId)
    if (netIndex === undefined) {
      netIndex = netIndexById.size
      netIndexById.set(netId, netIndex)
    }
    return netIndex
  }

  for (const connection of params.connections) {
    const routeMetadata: RouteMetadata = {
      connectionId: connection.connectionId,
      mutuallyConnectedNetworkId:
        connection.mutuallyConnectedNetworkId ?? connection.connectionId,
      simpleRouteConnection: connection.simpleRouteConnection,
    }
    const routeNetIndex = getNetIndex(routeMetadata)
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
        netId: routeNetIndex,
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
        netId: routeNetIndex,
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
    } as SerializedSolvedRoute)
  }

  return {
    regions,
    ports,
    connections,
    solvedRoutes,
  } satisfies SerializedHyperGraph
}

const buildInputNodesWithPortPoints = (
  params: HgPortPointPathingSolverParams,
  serializedHyperGraph: SerializedHyperGraph,
): InputNodeWithPortPoints[] => {
  const serializedRegionById = new Map(
    serializedHyperGraph.regions.map((region) => [region.regionId, region]),
  )
  const serializedPortById = new Map(
    serializedHyperGraph.ports.map((port) => [port.portId, port]),
  )

  return params.graph.regions.map((region) => {
    const serializedRegion = serializedRegionById.get(region.regionId)
    const portPoints = (
      serializedRegion?.pointIds ?? region.ports.map((port) => port.d.portId)
    )
      .map((portId) => serializedPortById.get(portId))
      .filter((port) => port && !asTinyPortMetadata(port.d)._tinyTerminal)
      .map((port) => {
        const serializedPort = port!
        const portMetadata = asTinyPortMetadata(serializedPort.d)
        const region1 = serializedRegionById.get(serializedPort.region1Id)
        const region2 = serializedRegionById.get(serializedPort.region2Id)
        const connectsToOffBoardNode = Boolean(
          asTinyRegionMetadata(region1?.d)._offBoardConnectionId ??
            asTinyRegionMetadata(region2?.d)._offBoardConnectionId,
        )

        return {
          portPointId: serializedPort.portId,
          x: Number(portMetadata.x ?? 0),
          y: Number(portMetadata.y ?? 0),
          z: Number(portMetadata.z ?? 0),
          prevPortPointId:
            typeof portMetadata.prevPortPointId === "string"
              ? portMetadata.prevPortPointId
              : undefined,
          nextPortPointId:
            typeof portMetadata.nextPortPointId === "string"
              ? portMetadata.nextPortPointId
              : undefined,
          connectionNodeIds: [
            serializedPort.region1Id,
            serializedPort.region2Id,
          ] as [CapacityMeshNodeId, CapacityMeshNodeId],
          distToCentermostPortOnZ: Number(
            portMetadata.distToCentermostPortOnZ ?? 0,
          ),
          cramped: Boolean(portMetadata.cramped),
          connectsToOffBoardNode,
        } satisfies InputPortPoint
      })

    return {
      capacityMeshNodeId: region.d.capacityMeshNodeId,
      center: region.d.center,
      width: region.d.width,
      height: region.d.height,
      portPoints,
      availableZ: region.d.availableZ,
      _containsObstacle: region.d._containsObstacle,
      _containsTarget: region.d._containsTarget,
      _offBoardConnectionId: region.d._offBoardConnectionId,
      _offBoardConnectedCapacityMeshNodeIds:
        region.d._offBoardConnectedCapacityMeshNodeIds,
      _qfpRegionType: (region.d as typeof region.d & TinyRegionMetadata)
        ._qfpRegionType,
      _isNarrowQfpPadGap: (region.d as typeof region.d & TinyRegionMetadata)
        ._isNarrowQfpPadGap,
    }
  })
}

const applyTerminalRegionNetIds = (loaded: LoadedTinyGraph) => {
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

const applyPortMetadataPenalties = (loaded: LoadedTinyGraph) => {
  let duplicatePortPenaltyCount = 0
  let crampedPortPenaltyCount = 0
  const portPenalty = loaded.problem.portPenalty
    ? new Float64Array(loaded.problem.portPenalty)
    : new Float64Array(loaded.topology.portCount)

  for (let portId = 0; portId < loaded.topology.portCount; portId++) {
    const metadata = loaded.topology.portMetadata?.[portId]
    if (typeof metadata?.duplicatedFromPortId === "string") {
      portPenalty[portId] += DUPLICATE_PORT_TRAVERSAL_PENALTY
      duplicatePortPenaltyCount++
    }
    if (metadata?.cramped) {
      portPenalty[portId] += CRAMPED_PORT_TRAVERSAL_PENALTY
      crampedPortPenaltyCount++
    }
  }

  if (duplicatePortPenaltyCount > 0 || crampedPortPenaltyCount > 0) {
    loaded.problem.portPenalty = portPenalty
  }

  return { duplicatePortPenaltyCount, crampedPortPenaltyCount }
}

const applyMetadataPortPenalties = (loaded: LoadedTinyGraph) => {
  if (loaded.problem.metadataPortPenaltiesApplied) {
    return 0
  }

  let metadataPortPenaltyCount = 0
  const portPenalty = loaded.problem.portPenalty
    ? new Float64Array(loaded.problem.portPenalty)
    : new Float64Array(loaded.topology.portCount)

  for (let portId = 0; portId < loaded.topology.portCount; portId++) {
    const penalty = Number(
      loaded.topology.portMetadata?.[portId]?.tinyHypergraphPortPenalty,
    )
    if (!Number.isFinite(penalty) || penalty <= 0) {
      continue
    }

    portPenalty[portId] += penalty
    metadataPortPenaltyCount++
  }

  if (metadataPortPenaltyCount > 0) {
    loaded.problem.portPenalty = portPenalty
  }
  loaded.problem.metadataPortPenaltiesApplied = true

  return metadataPortPenaltyCount
}

class DuplicateCongestedPortPrepassSolver extends BaseSolver {
  private output?: DuplicateCongestedPortPrepassSolverOutput
  private duplicateSolver?: DuplicateCongestedPortSolver
  override activeSubSolver: DuplicateCongestedPortSolver | null = null

  constructor(
    public readonly inputProblem: DuplicateCongestedPortPrepassSolverInput,
  ) {
    super()
    const duplicateRouteMaxIterations = Math.ceil(
      2_000_000 * getEffortScale(this.inputProblem.effort),
    )
    this.MAX_ITERATIONS =
      this.inputProblem.connectionCount * duplicateRouteMaxIterations +
      this.inputProblem.connectionCount +
      DUPLICATE_CONGESTED_PORT_PREPASS_OVERHEAD_ITERATIONS
  }

  override getConstructorParams(): readonly [
    DuplicateCongestedPortPrepassSolverInput,
  ] {
    return [this.inputProblem] as const
  }

  override _step(): void {
    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      this.updateStats()

      if (!this.activeSubSolver.solved && !this.activeSubSolver.failed) {
        return
      }

      if (this.activeSubSolver.failed) {
        const duplicateSolverError =
          this.activeSubSolver.error ?? "DuplicateCongestedPortSolver failed"
        this.failedSubSolvers = [
          ...(this.failedSubSolvers ?? []),
          this.activeSubSolver,
        ]
        this.output = {
          serializedHyperGraph: this.inputProblem.serializedHyperGraph,
          report: this.activeSubSolver.report,
          error: duplicateSolverError,
          skipped: false,
          duplicatedPortCount:
            this.activeSubSolver.report.duplicatedPorts.flatMap(
              (duplicatedPort) => duplicatedPort.duplicatePortIds,
            ).length,
        }
        this.activeSubSolver = null
        this.updateStats()
        this.solved = true
        return
      }

      this.output = this.getOutputFromDuplicateSolver(this.activeSubSolver)
      this.activeSubSolver = null
      this.updateStats()
      this.solved = true
      return
    }

    const shouldRun =
      this.inputProblem.connectionCount <=
      MAX_CONNECTIONS_FOR_DUPLICATE_CONGESTED_PORT_PREPASS
    if (!shouldRun) {
      this.output = {
        serializedHyperGraph: this.inputProblem.serializedHyperGraph,
        error: `Skipped for ${this.inputProblem.connectionCount} connections`,
        skipped: true,
        duplicatedPortCount: 0,
      }
      this.updateStats()
      this.solved = true
      return
    }

    this.duplicateSolver = new DuplicateCongestedPortSolver(
      this.inputProblem.serializedHyperGraph,
      {
        duplicatePortProximity: 0.05,
        routeSolveOptions: {
          ...getTinyViaSizeOptions(this.inputProblem.minViaPadDiameter),
          USE_SPARSE_CANDIDATE_STORAGE: true,
          ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
          GREEDY_FINAL_ROUTE_ITERS: 4,
          MAX_ITERATIONS: Math.ceil(
            2_000_000 * getEffortScale(this.inputProblem.effort),
          ),
          RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
          STATIC_REACHABILITY_PRECHECK: true,
        },
      },
    )
    this.activeSubSolver = this.duplicateSolver
    this.updateStats()
  }

  override getOutput(): DuplicateCongestedPortPrepassSolverOutput {
    if (!this.output) {
      throw new Error("Duplicate congested port prepass has not completed")
    }

    return this.output
  }

  override visualize(): GraphicsObject {
    return this.duplicateSolver?.visualize() ?? super.visualize()
  }

  private getOutputFromDuplicateSolver(
    solver: DuplicateCongestedPortSolver,
  ): DuplicateCongestedPortPrepassSolverOutput {
    const duplicatedPortCount = solver.report.duplicatedPorts.reduce(
      (sum, duplicatedPort) => sum + duplicatedPort.duplicatePortIds.length,
      0,
    )
    return {
      serializedHyperGraph: solver.getOutput(),
      report: solver.report,
      skipped: false,
      duplicatedPortCount,
    }
  }

  private updateStats(): void {
    this.stats = {
      ...(this.duplicateSolver?.stats ?? {}),
      duplicateCongestedPortSourceCount:
        this.output?.report?.duplicatedPorts.length ?? 0,
      duplicateCongestedPortCount: this.output?.duplicatedPortCount ?? 0,
      duplicateCongestedPortFallbackToOriginal: Boolean(this.output?.error),
      duplicateCongestedPortSkipped: Boolean(this.output?.skipped),
      duplicateCongestedPortError: this.error ?? this.output?.error,
    }
  }
}

class TinyHyperGraphSectionPipelineWithTerminalNetIds extends TinyHyperGraphSectionPipelineSolver {
  private configuredSolvers = new WeakSet<BaseSolver>()
  duplicatePortPenaltyCount = 0
  metadataPortPenaltyCount = 0
  crampedPortPenaltyCount = 0

  constructor(inputProblem: TinyHyperGraphSectionPipelineInput) {
    super(inputProblem)
    this.MAX_ITERATIONS = getTinyHyperGraphPipelineMaxIterations(inputProblem)
  }

  override loadHyperGraph(serializedHyperGraph: SerializedHyperGraph) {
    const loaded = super.loadHyperGraph(serializedHyperGraph)
    const metadataPortPenaltyCount = applyMetadataPortPenalties(loaded)
    const { duplicatePortPenaltyCount, crampedPortPenaltyCount } =
      applyPortMetadataPenalties(loaded)
    applyTerminalRegionNetIds(loaded)
    this.metadataPortPenaltyCount = Math.max(
      this.metadataPortPenaltyCount,
      metadataPortPenaltyCount,
    )
    this.duplicatePortPenaltyCount = Math.max(
      this.duplicatePortPenaltyCount,
      duplicatePortPenaltyCount,
    )
    this.crampedPortPenaltyCount = Math.max(
      this.crampedPortPenaltyCount,
      crampedPortPenaltyCount,
    )
    return loaded
  }

  override _step(): void {
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
      const loadedSolver = solver as typeof solver & LoadedTinyGraph
      applyMetadataPortPenalties(loadedSolver)
      applyTerminalRegionNetIds(loadedSolver)
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

export class TinyHypergraphPortPointPathingSolver extends BasePipelineSolver<HgPortPointPathingSolverParams> {
  duplicateCongestedPortPrepassSolver?: DuplicateCongestedPortPrepassSolver
  tinyPipelineSolver?: TinyHyperGraphSectionPipelineWithTerminalNetIds
  private duplicateCongestedPortReport?: DuplicateCongestedPortSolverReport
  private duplicateCongestedPortError?: string
  private duplicatedPortCount = 0
  private inputNodesWithPortPoints?: InputNodeWithPortPoints[]
  private originalRegionById: Map<CapacityMeshNodeId, RegionHg>
  private originalRegionIds: Set<CapacityMeshNodeId>
  private originalSerializedHyperGraph: SerializedHyperGraph

  pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "duplicateCongestedPortPrepassSolver",
      DuplicateCongestedPortPrepassSolver,
      (instance: TinyHypergraphPortPointPathingSolver) => [
        instance.getDuplicateCongestedPortPrepassInput(),
      ],
    ),
    definePipelineStep(
      "tinyPipelineSolver",
      TinyHyperGraphSectionPipelineWithTerminalNetIds,
      (instance: TinyHypergraphPortPointPathingSolver) => [
        instance.getTinyPipelineInput(),
      ],
    ),
  ]

  constructor(params: HgPortPointPathingSolverParams) {
    super(params)
    this.originalSerializedHyperGraph = buildSerializedTinyGraph(params)
    const tinyPipelineMaxIterations = getTinyHyperGraphPipelineMaxIterations(
      this.getTinyPipelineInput(),
    )
    const duplicateRouteMaxIterations = Math.ceil(
      2_000_000 * getEffortScale(this.inputProblem.effort),
    )
    const duplicatePrepassMaxIterations =
      this.inputProblem.connections.length * duplicateRouteMaxIterations +
      this.inputProblem.connections.length +
      DUPLICATE_CONGESTED_PORT_PREPASS_OVERHEAD_ITERATIONS
    this.MAX_ITERATIONS =
      duplicatePrepassMaxIterations +
      tinyPipelineMaxIterations +
      OUTER_PIPELINE_STAGE_OVERHEAD_ITERATIONS

    this.originalRegionById = new Map(
      params.graph.regions.map((region) => [region.regionId, region]),
    )
    this.originalRegionIds = new Set(this.originalRegionById.keys())
  }

  getSolverName(): string {
    return "TinyHypergraphPortPointPathingSolver"
  }

  override _step(): void {
    try {
      super._step()
    } catch (error) {
      this.error = `${this.getSolverName()} error: ${error}`
      this.failed = true
      throw error
    }

    this.updateStatsFromPipeline()
  }

  private updateStatsFromPipeline(): void {
    const optimizeSectionSolver =
      this.tinyPipelineSolver?.getSolver<TinyHyperGraphSectionSolver>(
        "optimizeSection",
      )
    const currentTinySolver = this.getCurrentTinySolver()
    const duplicateOutput = this.getDuplicateCongestedPortOutput()
    this.duplicateCongestedPortReport = duplicateOutput?.report
    this.duplicateCongestedPortError = duplicateOutput?.error
    this.duplicatedPortCount = duplicateOutput?.duplicatedPortCount ?? 0

    this.stats = {
      duplicateCongestedPortSourceCount:
        this.duplicateCongestedPortReport?.duplicatedPorts.length ?? 0,
      duplicateCongestedPortCount: this.duplicatedPortCount,
      duplicateCongestedPortFallbackToOriginal: Boolean(
        this.duplicateCongestedPortError,
      ),
      duplicateCongestedPortSkipped: Boolean(duplicateOutput?.skipped),
      duplicateCongestedPortPenalty:
        this.duplicatedPortCount > 0 ? DUPLICATE_PORT_TRAVERSAL_PENALTY : 0,
      duplicateCongestedPortPenaltyCount:
        this.tinyPipelineSolver?.duplicatePortPenaltyCount ?? 0,
      metadataPortPenaltyCount:
        this.tinyPipelineSolver?.metadataPortPenaltyCount ?? 0,
      crampedPortPenalty: CRAMPED_PORT_TRAVERSAL_PENALTY,
      crampedPortPenaltyCount:
        this.tinyPipelineSolver?.crampedPortPenaltyCount ?? 0,
      duplicateCongestedPortError: this.duplicateCongestedPortError,
      ...(this.duplicateCongestedPortPrepassSolver?.stats ?? {}),
      ...(this.tinyPipelineSolver?.stats ?? {}),
      ...(currentTinySolver?.stats ?? {}),
      ...(optimizeSectionSolver?.stats ?? {}),
      currentStage: this.getCurrentStageName(),
      tinyCurrentStage: this.tinyPipelineSolver?.getCurrentStageName(),
      stageStats: this.getStageStats(),
      tinyStageStats: this.tinyPipelineSolver?.getStageStats(),
    }
  }

  override preview(): GraphicsObject {
    return super.preview()
  }

  private getCurrentTinySolver(): TinyHyperGraphSolver | undefined {
    const optimizeSectionSolver =
      this.tinyPipelineSolver?.getSolver<TinyHyperGraphSectionSolver>(
        "optimizeSection",
      )

    if (optimizeSectionSolver?.solved && !optimizeSectionSolver.failed) {
      return optimizeSectionSolver.getSolvedSolver()
    }

    const solveGraphSolver =
      this.tinyPipelineSolver?.getSolver<TinyHyperGraphSolver>("solveGraph")

    if (solveGraphSolver) {
      return solveGraphSolver
    }

    return undefined
  }

  private getSolvedTinySolver(): TinyHyperGraphSolver {
    if (!this.tinyPipelineSolver) {
      throw new Error("TinyHyperGraph section pipeline has not started")
    }

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
      portPointId: String(
        portMetadata?.serializedPortId ??
          portMetadata?.portId ??
          `tiny-port-${portId}`,
      ),
      x: solvedTinySolver.topology.portX[portId],
      y: solvedTinySolver.topology.portY[portId],
      z: solvedTinySolver.topology.portZ[portId],
      connectionName,
      rootConnectionName,
      prevPortPointId:
        typeof portMetadata?.prevPortPointId === "string"
          ? portMetadata.prevPortPointId
          : undefined,
      nextPortPointId:
        typeof portMetadata?.nextPortPointId === "string"
          ? portMetadata.nextPortPointId
          : undefined,
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

      const portPointsInPairs = regionSegments[regionId].map(
        ([routeId, fromPortId, toPortId]) => {
          const startPoint = this.createAssignedPortPoint(
            solvedTinySolver,
            routeId,
            fromPortId,
          )
          const endPoint = this.createAssignedPortPoint(
            solvedTinySolver,
            routeId,
            toPortId,
          )
          if (startPoint.portPointId && endPoint.portPointId) {
            startPoint.nextPortPointId = endPoint.portPointId
            endPoint.prevPortPointId = startPoint.portPointId
          }
          return [startPoint, endPoint] satisfies [PortPoint, PortPoint]
        },
      )
      const portPoints = portPointsInPairs.flat()

      if (portPoints.length === 0) {
        continue
      }

      nodesWithPortPoints.push({
        capacityMeshNodeId: originalRegion.d.capacityMeshNodeId,
        center: originalRegion.d.center,
        width: originalRegion.d.width,
        height: originalRegion.d.height,
        portPoints,
        portPointsInPairs,
        availableZ: originalRegion.d.availableZ,
      })
    }

    return {
      nodesWithPortPoints,
      inputNodeWithPortPoints: this.getInputNodeWithPortPoints(),
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

  override tryFinalAcceptance(): void {}

  override getConstructorParams(): readonly [HgPortPointPathingSolverParams] {
    return [this.inputProblem] as const
  }

  override visualize(): GraphicsObject {
    if ((!this.solved || this.failed) && this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }
    if (this.failed && this.tinyPipelineSolver) {
      return this.tinyPipelineSolver.visualize()
    }

    const duplicateVisualization =
      this.duplicateCongestedPortPrepassSolver?.visualize()
    const tinyVisualization = this.tinyPipelineSolver?.visualize()

    return tinyVisualization ?? duplicateVisualization ?? super.visualize()
  }

  private getDuplicateCongestedPortPrepassInput(): DuplicateCongestedPortPrepassSolverInput {
    return {
      serializedHyperGraph: this.originalSerializedHyperGraph,
      connectionCount: this.inputProblem.connections.length,
      effort: this.inputProblem.effort,
      minViaPadDiameter: this.inputProblem.minViaPadDiameter,
    }
  }

  private getDuplicateCongestedPortOutput():
    | DuplicateCongestedPortPrepassSolverOutput
    | undefined {
    return this.getStageOutput<DuplicateCongestedPortPrepassSolverOutput>(
      "duplicateCongestedPortPrepassSolver",
    )
  }

  private getGraphForTiny(): SerializedHyperGraph {
    const duplicateOutput = this.getDuplicateCongestedPortOutput()
    if (duplicateOutput) {
      return duplicateOutput.serializedHyperGraph
    }

    return this.originalSerializedHyperGraph
  }

  private getTinyPipelineInput(): TinyHyperGraphSectionPipelineInput {
    const graphForTiny = this.getGraphForTiny()
    return getTinyHyperGraphPipelineInput(
      {
        ...graphForTiny,
        solvedRoutes: this.originalSerializedHyperGraph.solvedRoutes,
      },
      this.inputProblem.effort,
      this.inputProblem.minViaPadDiameter,
    )
  }

  private getInputNodeWithPortPoints(): InputNodeWithPortPoints[] {
    if (this.inputNodesWithPortPoints) {
      return this.inputNodesWithPortPoints
    }

    this.inputNodesWithPortPoints = buildInputNodesWithPortPoints(
      this.inputProblem,
      this.getGraphForTiny(),
    )
    return this.inputNodesWithPortPoints
  }
}
