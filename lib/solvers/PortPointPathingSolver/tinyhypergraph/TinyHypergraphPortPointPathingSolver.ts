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
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import {
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
  type TinyHyperGraphSectionPipelineInput,
  type TinyHyperGraphSectionSolverOptions,
  type TinyHyperGraphSolverOptions,
} from "tiny-hypergraph/lib/index"
import * as TinyHyperGraphModule from "tiny-hypergraph/lib/index"
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
type DuplicateCongestedPortSolverReport = {
  duplicatedPorts: Array<{
    duplicatePortIds: string[]
  }>
}
type TinyHyperGraphCompatOptions = TinyHyperGraphSolverOptions & {
  ACCEPT_BEST_SOLUTION_ON_TIMEOUT?: boolean
  GREEDY_FINAL_ROUTE_ITERS?: number
  minViaPadDiameter?: number
  STATIC_REACHABILITY_PRECHECK?: boolean
}
type LoadedTinyHyperGraph = ReturnType<typeof loadSerializedHyperGraph> & {
  topology: ReturnType<typeof loadSerializedHyperGraph>["topology"] & {
    regionMetadata?: any[]
    portMetadata?: any[]
  }
  problem: ReturnType<typeof loadSerializedHyperGraph>["problem"] & {
    routeMetadata?: RouteMetadata[]
    portPenalty?: Float64Array
    metadataPortPenaltiesApplied?: boolean
  }
}
type LoadedTinySolver = Pick<LoadedTinyHyperGraph, "topology" | "problem">
type DuplicateCongestedPortSolverInstance = {
  solve(): void
  failed: boolean
  error?: string
  report?: DuplicateCongestedPortSolverReport
  getOutput(): SerializedHyperGraph
}
type DuplicateCongestedPortSolverConstructor = new (
  serializedGraph: SerializedHyperGraph,
  opts: {
    duplicatePortProximity: number
    routeSolveOptions: TinyHyperGraphCompatOptions
  },
) => DuplicateCongestedPortSolverInstance

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

/**
 * Reads region bounds from the input graph while tolerating older callers that
 * may omit or partially shape the field.
 */
const readInputRegionBounds = (
  regionData: HgPortPointPathingSolverParams["graph"]["regions"][number]["d"],
) => {
  if (!("bounds" in regionData)) {
    return undefined
  }

  const { bounds } = regionData
  if (
    !isRecord(bounds) ||
    typeof bounds.minX !== "number" ||
    typeof bounds.maxX !== "number" ||
    typeof bounds.minY !== "number" ||
    typeof bounds.maxY !== "number"
  ) {
    return undefined
  }

  return bounds
}

const TINY_TERMINAL_REGION_SIZE = 1e-6
const TINY_SOLVE_GRAPH_BASE_OPTIONS: TinyHyperGraphCompatOptions = {
  DISTANCE_TO_COST: 0.05,
  RIP_THRESHOLD_START: 0.05,
  RIP_THRESHOLD_END: 0.8,
  RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
  ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
  GREEDY_FINAL_ROUTE_ITERS: 4,
}
const TINY_SECTION_SOLVER_BASE_OPTIONS: TinyHyperGraphCompatOptions &
  TinyHyperGraphSectionSolverOptions = {
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
const duplicateCongestedPortSolverExport = Reflect.get(
  TinyHyperGraphModule,
  "DuplicateCongestedPortSolver",
)
const DuplicateCongestedPortSolverCtor:
  | DuplicateCongestedPortSolverConstructor
  | undefined =
  typeof duplicateCongestedPortSolverExport === "function"
    ? duplicateCongestedPortSolverExport
    : undefined

const getEffortScale = (effort: number) => Math.max(effort, 1e-2)

const getTinyViaSizeOptions = (
  minViaPadDiameter?: number,
): Pick<TinyHyperGraphCompatOptions, "minViaPadDiameter"> =>
  Number.isFinite(minViaPadDiameter)
    ? { minViaPadDiameter: minViaPadDiameter }
    : {}

const getTinyHyperGraphSolveGraphOptions = (
  effort: number,
  minViaPadDiameter?: number,
): TinyHyperGraphCompatOptions => {
  const effortScale = getEffortScale(effort)
  return {
    ...TINY_SOLVE_GRAPH_BASE_OPTIONS,
    ...getTinyViaSizeOptions(minViaPadDiameter),
    RIP_THRESHOLD_RAMP_ATTEMPTS: Math.ceil(10 * effortScale),
    MAX_ITERATIONS: Math.ceil(2_000_000 * effortScale),
  }
}

const getTinyHyperGraphSectionSolverOptions = (
  effort: number,
  minViaPadDiameter?: number,
): TinyHyperGraphCompatOptions & TinyHyperGraphSectionSolverOptions => {
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

const toSerializedRegionData = (
  region: HgPortPointPathingSolverParams["graph"]["regions"][number],
) => {
  const bounds = readInputRegionBounds(region.d)

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
    _parentObstacleIds:
      region.d._parentObstacleIds === undefined
        ? undefined
        : [...region.d._parentObstacleIds],
    _containsTarget: region.d._containsTarget,
    _offBoardConnectionId: region.d._offBoardConnectionId,
    _offBoardConnectedCapacityMeshNodeIds:
      region.d._offBoardConnectedCapacityMeshNodeIds === undefined
        ? undefined
        : [...region.d._offBoardConnectedCapacityMeshNodeIds],
    _qfpRegionType: region.d._qfpRegionType,
    _isNarrowQfpPadGap: region.d._isNarrowQfpPadGap,
  }
}

const toSerializedPortData = (
  port: HgPortPointPathingSolverParams["graph"]["ports"][number],
) => ({
  portId: port.d.portId,
  x: port.d.x,
  y: port.d.y,
  z: port.d.z,
  distToCentermostPortOnZ: port.d.distToCentermostPortOnZ,
  tinyHypergraphPortPenalty: port.d.tinyHypergraphPortPenalty,
  cramped: port.d.cramped,
})

const buildSerializedTinyGraph = (
  params: HgPortPointPathingSolverParams,
): SerializedHyperGraph => {
  const regions: SerializedHyperGraph["regions"] = params.graph.regions.map(
    (region) => ({
      regionId: region.regionId,
      pointIds: region.ports.map((port) => port.d.portId),
      d: toSerializedRegionData(region),
    }),
  )

  const ports: SerializedHyperGraph["ports"] = params.graph.ports.map(
    (port) => ({
      portId: port.d.portId,
      region1Id: port.region1.regionId,
      region2Id: port.region2.regionId,
      d: toSerializedPortData(port),
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

    const solvedRoute: SerializedTinySolvedRoute = {
      connection: {
        connectionId: connection.connectionId,
        mutuallyConnectedNetworkId:
          connection.mutuallyConnectedNetworkId ?? connection.connectionId,
        startRegionId: connection.startRegion.regionId,
        endRegionId: connection.endRegion.regionId,
      },
      requiredRip: false,
      path: [
        {
          portId: startTerminalPortId,
          g: 0,
          h: 0,
          f: 0,
          hops: 0,
          ripRequired: false,
        },
        {
          portId: endTerminalPortId,
          g: 0,
          h: 0,
          f: 0,
          hops: 1,
          ripRequired: false,
        },
      ],
    }
    solvedRoutes.push(solvedRoute)
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
      .filter(
        (port): port is SerializedHyperGraph["ports"][number] =>
          port != null && !port.d?._tinyTerminal,
      )
      .map((port) => {
        const region1 = serializedRegionById.get(port.region1Id)
        const region2 = serializedRegionById.get(port.region2Id)
        const connectsToOffBoardNode = Boolean(
          region1?.d?._offBoardConnectionId ??
            region2?.d?._offBoardConnectionId,
        )
        const connectionNodeIds: [CapacityMeshNodeId, CapacityMeshNodeId] = [
          port.region1Id,
          port.region2Id,
        ]

        return {
          portPointId: port.portId,
          x: Number(port.d?.x ?? 0),
          y: Number(port.d?.y ?? 0),
          z: Number(port.d?.z ?? 0),
          connectionNodeIds,
          distToCentermostPortOnZ: Number(port.d?.distToCentermostPortOnZ ?? 0),
          cramped: Boolean(port.d?.cramped),
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
      _qfpRegionType: region.d._qfpRegionType,
      _isNarrowQfpPadGap: region.d._isNarrowQfpPadGap,
    }
  })
}

const applyTerminalRegionNetIds = (loaded: LoadedTinySolver) => {
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

const applyPortMetadataPenalties = (loaded: LoadedTinySolver) => {
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

const applyMetadataPortPenalties = (loaded: LoadedTinySolver) => {
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

/**
 * Loads a serialized hypergraph and applies all metadata-derived penalties and
 * terminal net bookkeeping before any tiny-hypergraph solver consumes it.
 */
const loadConfiguredTinyHyperGraph = (
  serializedHyperGraph: SerializedHyperGraph,
) => {
  const loaded: LoadedTinyHyperGraph =
    loadSerializedHyperGraph(serializedHyperGraph)
  const metadataPortPenaltyCount = applyMetadataPortPenalties(loaded)
  const { duplicatePortPenaltyCount, crampedPortPenaltyCount } =
    applyPortMetadataPenalties(loaded)
  applyTerminalRegionNetIds(loaded)

  return {
    loaded,
    metadataPortPenaltyCount,
    duplicatePortPenaltyCount,
    crampedPortPenaltyCount,
  }
}

class TinyHyperGraphSectionPipelineWithTerminalNetIds extends TinyHyperGraphSectionPipelineSolver {
  duplicatePortPenaltyCount = 0
  metadataPortPenaltyCount = 0
  crampedPortPenaltyCount = 0

  constructor(inputProblem: TinyHyperGraphSectionPipelineInput) {
    super(inputProblem)
    this.MAX_ITERATIONS = getTinyHyperGraphPipelineMaxIterations(inputProblem)
  }

  override pipelineDef: TinyHyperGraphSectionPipelineSolver["pipelineDef"] = [
    {
      solverName: "solveGraph",
      solverClass: TinyHyperGraphSolver,
      getConstructorParams: (instance: TinyHyperGraphSectionPipelineSolver) => {
        const { loaded } = loadConfiguredTinyHyperGraph(
          instance.inputProblem.serializedHyperGraph,
        )

        return [
          loaded.topology,
          loaded.problem,
          {
            RIP_THRESHOLD_RAMP_ATTEMPTS: 5,
            ...instance.inputProblem.solveGraphOptions,
          },
        ] satisfies ConstructorParameters<typeof TinyHyperGraphSolver>
      },
    },
    {
      solverName: "optimizeSection",
      solverClass: TinyHyperGraphSectionSolver,
      getConstructorParams: (instance: TinyHyperGraphSectionPipelineSolver) =>
        instance.getSectionStageParams(),
    },
  ]

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
  }

  override getInitialVisualizationSolver() {
    if (!this.initialVisualizationSolver) {
      const { loaded, ...counts } = loadConfiguredTinyHyperGraph(
        this.inputProblem.serializedHyperGraph,
      )
      this.recordPenaltyCounts(counts)
      this.initialVisualizationSolver = new TinyHyperGraphSolver(
        loaded.topology,
        loaded.problem,
        {
          RIP_THRESHOLD_RAMP_ATTEMPTS: 5,
          ...this.inputProblem.solveGraphOptions,
        },
      )
    }

    return this.initialVisualizationSolver
  }

  override getSectionStageParams() {
    const solvedSerializedHyperGraph =
      this.getStageOutput<SerializedHyperGraph>("solveGraph")

    if (!solvedSerializedHyperGraph) {
      throw new Error(
        "solveGraph did not produce a solved serialized hypergraph",
      )
    }

    const solvedSolver = this.getSolver<TinyHyperGraphSolver>("solveGraph")

    if (!solvedSolver) {
      throw new Error("solveGraph solver is unavailable")
    }

    const sectionSolverOptions = {
      DISTANCE_TO_COST: 0.05,
      RIP_THRESHOLD_RAMP_ATTEMPTS: 16,
      RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
      MAX_ITERATIONS: 1e6,
      MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: 6,
      EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST:
        Number.POSITIVE_INFINITY,
      ...this.inputProblem.sectionSolverOptions,
    }
    const { loaded, ...counts } = loadConfiguredTinyHyperGraph(
      solvedSerializedHyperGraph,
    )
    this.recordPenaltyCounts(counts)

    const portSectionMask = this.inputProblem.createSectionMask
      ? this.inputProblem.createSectionMask({
          serializedHyperGraph: this.inputProblem.serializedHyperGraph,
          solvedSerializedHyperGraph,
          solvedSolver,
          topology: loaded.topology,
          problem: loaded.problem,
          solution: loaded.solution,
        })
      : new Int8Array(loaded.topology.portCount)

    this.selectedSectionMask = new Int8Array(portSectionMask)
    loaded.problem.portSectionMask = new Int8Array(portSectionMask)
    this.stats = {
      ...this.stats,
      sectionMaskPortCount: [...portSectionMask].filter((value) => value === 1)
        .length,
    }

    return [
      loaded.topology,
      loaded.problem,
      loaded.solution,
      sectionSolverOptions,
    ] satisfies ConstructorParameters<typeof TinyHyperGraphSectionSolver>
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

  private recordPenaltyCounts(counts: {
    metadataPortPenaltyCount: number
    duplicatePortPenaltyCount: number
    crampedPortPenaltyCount: number
  }) {
    this.metadataPortPenaltyCount = Math.max(
      this.metadataPortPenaltyCount,
      counts.metadataPortPenaltyCount,
    )
    this.duplicatePortPenaltyCount = Math.max(
      this.duplicatePortPenaltyCount,
      counts.duplicatePortPenaltyCount,
    )
    this.crampedPortPenaltyCount = Math.max(
      this.crampedPortPenaltyCount,
      counts.crampedPortPenaltyCount,
    )
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
  private duplicateCongestedPortReport?: DuplicateCongestedPortSolverReport
  private duplicateCongestedPortError?: string
  private duplicatedPortCount = 0
  private inputNodeWithPortPoints: InputNodeWithPortPoints[]
  private originalRegionById: Map<
    CapacityMeshNodeId,
    HgPortPointPathingSolverParams["graph"]["regions"][number]
  >
  private originalRegionIds: Set<CapacityMeshNodeId>

  constructor(private params: HgPortPointPathingSolverParams) {
    super()
    const serializedGraph = buildSerializedTinyGraph(params)
    const duplicateCongestedPortSolver = DuplicateCongestedPortSolverCtor
      ? new DuplicateCongestedPortSolverCtor(serializedGraph, {
          duplicatePortProximity: 0.05,
          routeSolveOptions: {
            ...getTinyViaSizeOptions(params.minViaPadDiameter),
            ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
            GREEDY_FINAL_ROUTE_ITERS: 4,
            MAX_ITERATIONS: Math.ceil(
              2_000_000 * getEffortScale(params.effort),
            ),
            RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
            STATIC_REACHABILITY_PRECHECK: false,
          },
        })
      : null
    duplicateCongestedPortSolver?.solve()
    let graphForTiny = serializedGraph
    if (!duplicateCongestedPortSolver) {
      this.duplicateCongestedPortError =
        "DuplicateCongestedPortSolver unavailable in installed tiny-hypergraph"
    } else if (duplicateCongestedPortSolver.failed) {
      this.duplicateCongestedPortError =
        duplicateCongestedPortSolver.error ?? "unknown error"
    } else {
      this.duplicateCongestedPortReport = duplicateCongestedPortSolver.report
      graphForTiny = duplicateCongestedPortSolver.getOutput()
    }
    this.duplicatedPortCount =
      this.duplicateCongestedPortReport?.duplicatedPorts.reduce(
        (sum: number, duplicatedPort: { duplicatePortIds: string[] }) =>
          sum + duplicatedPort.duplicatePortIds.length,
        0,
      ) ?? 0
    const tinyPipelineInput = getTinyHyperGraphPipelineInput(
      {
        ...graphForTiny,
        solvedRoutes: serializedGraph.solvedRoutes,
      },
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
    this.inputNodeWithPortPoints = buildInputNodesWithPortPoints(
      params,
      graphForTiny,
    )
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
      duplicateCongestedPortSourceCount:
        this.duplicateCongestedPortReport?.duplicatedPorts.length ?? 0,
      duplicateCongestedPortCount:
        this.duplicateCongestedPortReport?.duplicatedPorts.reduce(
          (sum: number, duplicatedPort: { duplicatePortIds: string[] }) =>
            sum + duplicatedPort.duplicatePortIds.length,
          0,
        ) ?? 0,
      duplicateCongestedPortFallbackToOriginal: Boolean(
        this.duplicateCongestedPortError,
      ),
      duplicateCongestedPortPenalty:
        this.duplicatedPortCount > 0 ? DUPLICATE_PORT_TRAVERSAL_PENALTY : 0,
      duplicateCongestedPortPenaltyCount:
        this.tinyPipelineSolver.duplicatePortPenaltyCount,
      metadataPortPenaltyCount:
        this.tinyPipelineSolver.metadataPortPenaltyCount,
      crampedPortPenalty: CRAMPED_PORT_TRAVERSAL_PENALTY,
      crampedPortPenaltyCount: this.tinyPipelineSolver.crampedPortPenaltyCount,
      duplicateCongestedPortError: this.duplicateCongestedPortError,
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
        ([routeId, fromPortId, toPortId]) =>
          [
            this.createAssignedPortPoint(solvedTinySolver, routeId, fromPortId),
            this.createAssignedPortPoint(solvedTinySolver, routeId, toPortId),
          ] satisfies [PortPoint, PortPoint],
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
    const constructorParams: [HgPortPointPathingSolverParams] = [this.params]
    return constructorParams
  }

  visualize(): GraphicsObject {
    return this.tinyPipelineSolver.visualize()
  }
}
