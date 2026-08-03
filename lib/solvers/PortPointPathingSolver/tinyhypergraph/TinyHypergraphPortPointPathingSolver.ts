import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { PreloadedTracePortAssignment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
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
  DuplicateCongestedPortSolver,
  orderConnectionsByNetCardinality,
  type DuplicateCongestedPortSolverReport,
  TinyHyperGraphSectionPipelineSolver,
  TinyHyperGraphSectionSolver,
  TinyHyperGraphSolver,
  type TinyHyperGraphSectionPipelineInput,
  type TinyHyperGraphSectionSolverOptions,
  type TinyHyperGraphSolverOptions,
} from "tiny-hypergraph/lib/index"
import type {
  ConnectionHg,
  ConnectionHgWithSimpleRouteConnection,
  HgPortPointPathingSolverParams,
} from "../hgportpointpathingsolver/types"
import { createTinyRouteNetIndexer } from "./createTinyRouteNetIndexer"
import { getRegionNetIdByRegionId } from "./getRegionNetIdByRegionId"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "./SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import {
  getSerializedPreloadedTraceStats,
  isPreloadedTraceConnectionId,
  serializePreloadedTraceAssignments,
} from "./serializePreloadedTraceAssignments"

type RouteMetadata = {
  connectionId: string
  mutuallyConnectedNetworkId: string
  startRegionId?: string
  endRegionId?: string
  simpleRouteConnection?: HgPortPointPathingSolverParams["connections"][number]["simpleRouteConnection"]
}

type SerializedTinyConnection = NonNullable<
  SerializedHyperGraph["connections"]
>[number]
type SerializedTinySolvedRoute = NonNullable<
  SerializedHyperGraph["solvedRoutes"]
>[number]
type TinyRouteConnection = ConnectionHgWithSimpleRouteConnection
type TinyHypergraphInput = Omit<
  HgPortPointPathingSolverParams,
  "connections"
> & {
  connections: TinyRouteConnection[]
}

type TinyBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type TinyRegionMetadata = {
  bounds?: TinyBounds
  netId?: number
  NetId?: number
  serializedRegionId?: string
  _qfpRegionType?: InputNodeWithPortPoints["_qfpRegionType"]
  _isNarrowQfpPadGap?: boolean
  _offBoardConnectionId?: string
}

type TinyPortMetadata = {
  x?: number
  y?: number
  z?: number
  pcb_port_id?: string
  prevPortPointId?: string
  nextPortPointId?: string
  distToCentermostPortOnZ?: number
  cramped?: boolean
  _tinyTerminal?: boolean
  tinyHypergraphPortPenalty?: number
  duplicatedFromPortId?: string
  _preloadedFixedNetIds?: string[]
  _preloadedTracePortAssignments?: PreloadedTracePortAssignment[]
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
const DEFAULT_CRAMPED_PORT_TRAVERSAL_PENALTY = 150
const MAX_CONNECTIONS_FOR_DUPLICATE_CONGESTED_PORT_PREPASS = 180
const SOLVE_GRAPH_ITERATIONS_PER_CONNECTION = 20_000

const getEffortScale = (effort: number) => Math.max(effort, 1e-2)

const getTinyViaSizeOptions = (
  minViaPadDiameter?: number,
): Pick<TinyHyperGraphSolverOptions, "minViaPadDiameter"> =>
  Number.isFinite(minViaPadDiameter)
    ? { minViaPadDiameter: minViaPadDiameter }
    : {}

const getTinyHyperGraphSolveGraphOptions = (
  effort: number,
  connectionCount: number,
  minViaPadDiameter?: number,
): TinyHyperGraphSolverOptions => {
  const effortScale = getEffortScale(effort)
  return {
    ...TINY_SOLVE_GRAPH_BASE_OPTIONS,
    ...getTinyViaSizeOptions(minViaPadDiameter),
    USE_SPARSE_CANDIDATE_STORAGE: true,
    RIP_THRESHOLD_RAMP_ATTEMPTS: Math.ceil(10 * effortScale),
    MAX_ITERATIONS: Math.ceil(
      Math.max(
        2_000_000,
        connectionCount * SOLVE_GRAPH_ITERATIONS_PER_CONNECTION,
      ) * effortScale,
    ),
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
    serializedHyperGraph.connections.length,
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

const getTinyRouteConnectionNetId = (connection: TinyRouteConnection): string =>
  connection.mutuallyConnectedNetworkId

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
  netId?: number,
) => {
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
    ...(netId !== undefined ? { netId } : {}),
  }
}

const toSerializedPortData = (
  port: HgPortPointPathingSolverParams["graph"]["ports"][number],
) => {
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
    _preloadedFixedNetIds: port.d._preloadedFixedNetIds,
    _preloadedTracePortAssignments: port.d._preloadedTracePortAssignments,
  }
}

const getTinyRouteConnectionsOrThrow = (
  connections: ConnectionHg[],
): TinyRouteConnection[] => {
  return connections.map((connection) => {
    const simpleRouteConnection = connection.simpleRouteConnection
    if (!simpleRouteConnection) {
      throw new Error(
        `TinyHypergraphPortPointPathingSolver requires a SimpleRouteConnection for "${connection.connectionId}"`,
      )
    }
    const mutuallyConnectedNetworkId = connection.mutuallyConnectedNetworkId
    if (!mutuallyConnectedNetworkId) {
      throw new Error(
        `TinyHypergraphPortPointPathingSolver requires a net ID for "${connection.connectionId}"`,
      )
    }
    return {
      ...connection,
      mutuallyConnectedNetworkId,
      simpleRouteConnection,
    }
  })
}

const buildSerializedTinyGraph = (
  params: TinyHypergraphInput,
): SerializedHyperGraph => {
  const getNetIndex = createTinyRouteNetIndexer()
  const regionNetIdByRegionId = getRegionNetIdByRegionId({
    params,
    getNetIndex,
  })

  const regions: SerializedHyperGraph["regions"] = params.graph.regions.map(
    (region) => ({
      regionId: region.regionId,
      pointIds: region.ports.map((port) => port.d.portId),
      d: toSerializedRegionData(
        region,
        regionNetIdByRegionId.get(region.regionId),
      ),
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
      mutuallyConnectedNetworkId: connection.mutuallyConnectedNetworkId,
      startRegionId: connection.startRegion.regionId,
      endRegionId: connection.endRegion.regionId,
      simpleRouteConnection: connection.simpleRouteConnection,
    }),
  )

  const solvedRoutes: SerializedTinySolvedRoute[] = []
  for (const connection of params.connections) {
    const routeMetadata: RouteMetadata = {
      connectionId: connection.connectionId,
      mutuallyConnectedNetworkId: connection.mutuallyConnectedNetworkId,
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
        _tinyTerminalNetId: connection.mutuallyConnectedNetworkId,
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
        _tinyTerminalNetId: connection.mutuallyConnectedNetworkId,
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
        ...(params.preserveTerminalPcbPortIds && startPoint?.pcb_port_id
          ? { pcb_port_id: startPoint.pcb_port_id }
          : {}),
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
        ...(params.preserveTerminalPcbPortIds && endPoint?.pcb_port_id
          ? { pcb_port_id: endPoint.pcb_port_id }
          : {}),
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

  const serializedHyperGraph = {
    regions,
    ports,
    connections,
    solvedRoutes,
  } satisfies SerializedHyperGraph
  serializePreloadedTraceAssignments(serializedHyperGraph)
  return serializedHyperGraph
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
    const netId = routeMetadata?.mutuallyConnectedNetworkId
    if (typeof netId !== "string" || netId.length === 0) {
      throw new Error(`Tiny hypergraph route ${routeId} is missing a net ID`)
    }
    netIndexById.set(netId, loaded.problem.routeNet[routeId]!)
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

const clearPreloadedEndpointRegionNetIds = (loaded: LoadedTinyGraph) => {
  const regionIndexBySerializedId = new Map<string, number>()
  loaded.topology.regionMetadata?.forEach((metadata, regionIndex) => {
    if (typeof metadata.serializedRegionId === "string") {
      regionIndexBySerializedId.set(metadata.serializedRegionId, regionIndex)
    }
  })

  const activeEndpointRegionIds = new Set<string>()
  for (const routeMetadata of loaded.problem.routeMetadata ?? []) {
    if (isPreloadedTraceConnectionId(routeMetadata.connectionId)) continue
    if (typeof routeMetadata.startRegionId === "string") {
      activeEndpointRegionIds.add(routeMetadata.startRegionId)
    }
    if (typeof routeMetadata.endRegionId === "string") {
      activeEndpointRegionIds.add(routeMetadata.endRegionId)
    }
  }

  for (const routeMetadata of loaded.problem.routeMetadata ?? []) {
    if (!isPreloadedTraceConnectionId(routeMetadata.connectionId)) continue
    for (const serializedRegionId of [
      routeMetadata.startRegionId,
      routeMetadata.endRegionId,
    ]) {
      if (
        typeof serializedRegionId !== "string" ||
        activeEndpointRegionIds.has(serializedRegionId)
      ) {
        continue
      }
      const regionIndex = regionIndexBySerializedId.get(serializedRegionId)
      if (regionIndex === undefined) continue
      const metadata = loaded.topology.regionMetadata?.[regionIndex]
      const hasExplicitNetId =
        typeof metadata?.netId === "number" ||
        typeof metadata?.NetId === "number"
      if (!hasExplicitNetId) {
        loaded.problem.regionNetId[regionIndex] = -1
      }
    }
  }
}

const applyPortMetadataPenalties = (
  loaded: LoadedTinyGraph,
  crampedPortTraversalPenalty: number,
) => {
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
    if (metadata?.cramped && crampedPortTraversalPenalty > 0) {
      portPenalty[portId] += crampedPortTraversalPenalty
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

class TinyHyperGraphSectionPipelineWithTerminalNetIds extends TinyHyperGraphSectionPipelineSolver {
  private configuredSolvers = new WeakSet<BaseSolver>()
  duplicatePortPenaltyCount = 0
  metadataPortPenaltyCount = 0
  crampedPortPenaltyCount = 0
  preloadedPortCount = 0
  preloadedFixedSegmentCount = 0
  readonly crampedPortTraversalPenalty: number
  readonly useSelectiveReripRouting: boolean

  constructor(
    inputProblem: TinyHyperGraphSectionPipelineInput,
    useSelectiveReripRouting: boolean,
  ) {
    super(inputProblem)
    this.useSelectiveReripRouting = useSelectiveReripRouting
    this.crampedPortTraversalPenalty = DEFAULT_CRAMPED_PORT_TRAVERSAL_PENALTY
    const preloadedStats = getSerializedPreloadedTraceStats(
      inputProblem.serializedHyperGraph,
    )
    this.preloadedPortCount = preloadedStats.preloadedPortCount
    this.preloadedFixedSegmentCount = preloadedStats.preloadedAssignmentCount
    if (useSelectiveReripRouting) {
      const solveGraphStep = this.pipelineDef.find(
        (pipelineStep) => pipelineStep.solverName === "solveGraph",
      )
      if (!solveGraphStep) {
        throw new Error(
          "Tiny hypergraph pipeline is missing the solveGraph stage",
        )
      }
      solveGraphStep.solverClass =
        SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments
    }
    if (preloadedStats.preloadedAssignmentCount > 0) {
      this.pipelineDef = this.pipelineDef.filter(
        (pipelineStep) => pipelineStep.solverName !== "optimizeSection",
      )
    }
    this.MAX_ITERATIONS = getTinyHyperGraphPipelineMaxIterations(inputProblem)
  }

  override loadHyperGraph(serializedHyperGraph: SerializedHyperGraph) {
    const loaded = super.loadHyperGraph(serializedHyperGraph)
    const metadataPortPenaltyCount = applyMetadataPortPenalties(loaded)
    const { duplicatePortPenaltyCount, crampedPortPenaltyCount } =
      applyPortMetadataPenalties(loaded, this.crampedPortTraversalPenalty)
    applyTerminalRegionNetIds(loaded)
    clearPreloadedEndpointRegionNetIds(loaded)
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
    if (this.useSelectiveReripRouting && !this.initialVisualizationSolver) {
      const { topology, problem } = this.loadHyperGraph(
        this.inputProblem.serializedHyperGraph,
      )
      this.initialVisualizationSolver =
        new SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments(
          topology,
          problem,
          this.getSolveGraphOptions(),
        )
    }
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
      clearPreloadedEndpointRegionNetIds(loadedSolver)
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
  private duplicateCongestedPortReport?: DuplicateCongestedPortSolverReport
  private duplicateCongestedPortError?: string
  private duplicatedPortCount = 0
  private inputNodeWithPortPoints: InputNodeWithPortPoints[]
  private originalRegionById: Map<
    CapacityMeshNodeId,
    HgPortPointPathingSolverParams["graph"]["regions"][number]
  >
  private originalRegionIds: Set<CapacityMeshNodeId>
  private rootConnectionNameByConnectionId: Map<string, string | undefined>

  constructor(private params: HgPortPointPathingSolverParams) {
    super()
    const tinyRouteConnections = getTinyRouteConnectionsOrThrow(
      params.connections,
    )
    const connections = params.flags.USE_SELECTIVE_RERIP_ROUTING
      ? orderConnectionsByNetCardinality(
          tinyRouteConnections,
          getTinyRouteConnectionNetId,
        )
      : tinyRouteConnections
    this.rootConnectionNameByConnectionId = new Map(
      connections.map((connection) => [
        connection.connectionId,
        connection.simpleRouteConnection.__rootConnectionNames?.[0],
      ]),
    )
    const serializedGraph = buildSerializedTinyGraph({ ...params, connections })
    const preloadedTraceStats =
      getSerializedPreloadedTraceStats(serializedGraph)
    const hasPreloadedTraceOccupancy =
      preloadedTraceStats.preloadedPortCount > 0
    const shouldRunDuplicateCongestedPortPrepass =
      !hasPreloadedTraceOccupancy &&
      connections.length <= MAX_CONNECTIONS_FOR_DUPLICATE_CONGESTED_PORT_PREPASS
    let graphForTiny = serializedGraph
    if (shouldRunDuplicateCongestedPortPrepass) {
      const duplicateCongestedPortSolver = new DuplicateCongestedPortSolver(
        serializedGraph,
        {
          duplicatePortProximity: 0.05,
          routeSolveOptions: {
            ...getTinyViaSizeOptions(params.minViaPadDiameter),
            USE_SPARSE_CANDIDATE_STORAGE: true,
            ACCEPT_BEST_SOLUTION_ON_TIMEOUT: true,
            GREEDY_FINAL_ROUTE_ITERS: 4,
            MAX_ITERATIONS: Math.ceil(
              2_000_000 * getEffortScale(params.effort),
            ),
            RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
            STATIC_REACHABILITY_PRECHECK: true,
          },
        },
      )
      duplicateCongestedPortSolver.solve()
      if (duplicateCongestedPortSolver.failed) {
        this.duplicateCongestedPortError =
          duplicateCongestedPortSolver.error ?? "unknown error"
      } else {
        this.duplicateCongestedPortReport = duplicateCongestedPortSolver.report
        graphForTiny = duplicateCongestedPortSolver.getOutput()
      }
    } else {
      this.duplicateCongestedPortError = hasPreloadedTraceOccupancy
        ? "Skipped to preserve preloaded port topology"
        : `Skipped for ${connections.length} connections`
    }
    this.duplicatedPortCount =
      this.duplicateCongestedPortReport?.duplicatedPorts.reduce(
        (sum, duplicatedPort) => sum + duplicatedPort.duplicatePortIds.length,
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
      new TinyHyperGraphSectionPipelineWithTerminalNetIds(
        tinyPipelineInput,
        params.flags.USE_SELECTIVE_RERIP_ROUTING === true,
      )
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
          (sum, duplicatedPort) => sum + duplicatedPort.duplicatePortIds.length,
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
      crampedPortPenalty: this.tinyPipelineSolver.crampedPortTraversalPenalty,
      crampedPortPenaltyCount: this.tinyPipelineSolver.crampedPortPenaltyCount,
      preloadedPortCount: this.tinyPipelineSolver.preloadedPortCount,
      preloadedFixedSegmentCount:
        this.tinyPipelineSolver.preloadedFixedSegmentCount,
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
      ? this.rootConnectionNameByConnectionId.get(routeMetadata.connectionId)
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
      ...(this.params.preserveTerminalPcbPortIds &&
      typeof portMetadata?.pcb_port_id === "string"
        ? { pcb_port_id: portMetadata.pcb_port_id }
        : {}),
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

      const portPointsInPairs = regionSegments[regionId]
        .filter(([routeId]) => {
          const connectionId = this.getRouteMetadata(
            solvedTinySolver,
            routeId,
          )?.connectionId
          return (
            typeof connectionId !== "string" ||
            !isPreloadedTraceConnectionId(connectionId)
          )
        })
        .map(([routeId, fromPortId, toPortId]) => {
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
        })
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
    return [this.params] as const
  }

  visualize(): GraphicsObject {
    return this.tinyPipelineSolver.visualize()
  }
}
