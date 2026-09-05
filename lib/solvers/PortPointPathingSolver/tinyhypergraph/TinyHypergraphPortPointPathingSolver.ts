import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { PreloadedTracePortAssignment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import {
  type CapacityMeshNodeId,
  getConnectionPointLayers,
  type SimpleRouteConnection,
} from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import {
  DuplicateCongestedPortSolver,
  orderConnectionsByNetCardinality,
  type DuplicateCongestedPortSolverReport,
  SelectiveReripTinyHyperGraphSolver,
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
  hasPreloadedTraceSectionMetadata,
  type PreloadedTraceConnectionId,
  type PreloadedTraceSectionMetadata,
  serializePreloadedTraceAssignments,
} from "./serializePreloadedTraceAssignments"

type RouteMetadata = {
  connectionId: string
  mutuallyConnectedNetworkId: string
  startRegionId?: string
  endRegionId?: string
  simpleRouteConnection?: HgPortPointPathingSolverParams["connections"][number]["simpleRouteConnection"]
  preloadedTraceSection?: PreloadedTraceSectionMetadata
}

export type ChangedPreloadedTraceSection = {
  connectionName: PreloadedTraceConnectionId
  traceId: string
  startRoutePosition: number
  endRoutePosition: number
  connection: SimpleRouteConnection
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

type PreloadedTraceSegmentBaseline = ReadonlyMap<
  PreloadedTraceConnectionId,
  ReadonlySet<string>
>

type TinyBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type DownstreamCandidateSummary = {
  nodePfSum: number
  nodePfSquaredSum: number
  nodePfMax: number
  squaredNodePortPointCount: number
  segmentCount: number
  layerChangeCount: number
  changedPreloadedTraceSectionCount: number
}

type CandidatePortfolioPhase = "primary" | "alternative" | "complete"

// A second global-routing candidate is only worthwhile when the primary
// candidate predicts downstream congestion. Selection requires meaningful
// trace dispersion without materially increasing predicted failure pressure.
const TRACE_DENSITY_PORTFOLIO_MIN_ROUTE_COUNT = 30
const TRACE_DENSITY_PORTFOLIO_MAX_ROUTE_COUNT = 99
const TRACE_DENSITY_PORTFOLIO_MIN_PF_SUM = 4
const TRACE_DENSITY_PORTFOLIO_MIN_PF_MAX = 1
const TRACE_DENSITY_PORTFOLIO_MIN_CONCENTRATION_PER_ROUTE = 125
const TRACE_DENSITY_PORTFOLIO_MAX_PF_SUM_GROWTH = 1.03
const TRACE_DENSITY_PORTFOLIO_MAX_PF_SQUARED_GROWTH = 1.06
const TRACE_DENSITY_PORTFOLIO_SMALL_GRAPH_MAX_ROUTE_COUNT = 40
const TRACE_DENSITY_PORTFOLIO_SMALL_GRAPH_MAX_CONCENTRATION_RATIO = 0.95
const TRACE_DENSITY_PORTFOLIO_LARGE_GRAPH_MAX_CONCENTRATION_RATIO = 0.92
const TRACE_DENSITY_PORTFOLIO_STRONG_PF_SUM_RATIO = 0.9
const TRACE_DENSITY_PORTFOLIO_STRONG_PF_SQUARED_RATIO = 0.85
const TRACE_DENSITY_PORTFOLIO_STRONG_PF_MAX_RATIO = 0.85
const TRACE_DENSITY_PORTFOLIO_STRONG_CONCENTRATION_RATIO = 0.98
const TRACE_DENSITY_PORTFOLIO_STRONG_SEGMENT_RATIO = 0.97

export const shouldEvaluateTraceDensityAlternative = (
  summary: DownstreamCandidateSummary,
  routeCount: number,
) =>
  summary.nodePfSum > TRACE_DENSITY_PORTFOLIO_MIN_PF_SUM &&
  summary.nodePfMax > TRACE_DENSITY_PORTFOLIO_MIN_PF_MAX &&
  summary.squaredNodePortPointCount / Math.max(1, routeCount) >=
    TRACE_DENSITY_PORTFOLIO_MIN_CONCENTRATION_PER_ROUTE

export const shouldSelectTraceDensityAlternative = (
  primary: DownstreamCandidateSummary,
  alternative: DownstreamCandidateSummary,
  routeCount: number,
) => {
  if (
    alternative.changedPreloadedTraceSectionCount >
    primary.changedPreloadedTraceSectionCount
  ) {
    return false
  }

  const maxConcentrationRatio =
    routeCount > TRACE_DENSITY_PORTFOLIO_SMALL_GRAPH_MAX_ROUTE_COUNT
      ? TRACE_DENSITY_PORTFOLIO_LARGE_GRAPH_MAX_CONCENTRATION_RATIO
      : TRACE_DENSITY_PORTFOLIO_SMALL_GRAPH_MAX_CONCENTRATION_RATIO
  const stronglyReducesDownstreamPressure =
    alternative.nodePfSum <=
      primary.nodePfSum * TRACE_DENSITY_PORTFOLIO_STRONG_PF_SUM_RATIO &&
    alternative.nodePfSquaredSum <=
      primary.nodePfSquaredSum *
        TRACE_DENSITY_PORTFOLIO_STRONG_PF_SQUARED_RATIO &&
    alternative.nodePfMax <=
      primary.nodePfMax * TRACE_DENSITY_PORTFOLIO_STRONG_PF_MAX_RATIO &&
    alternative.squaredNodePortPointCount <
      primary.squaredNodePortPointCount *
        TRACE_DENSITY_PORTFOLIO_STRONG_CONCENTRATION_RATIO &&
    alternative.segmentCount <=
      primary.segmentCount * TRACE_DENSITY_PORTFOLIO_STRONG_SEGMENT_RATIO

  return (
    alternative.nodePfSum <=
      primary.nodePfSum * TRACE_DENSITY_PORTFOLIO_MAX_PF_SUM_GROWTH &&
    alternative.nodePfSquaredSum <=
      primary.nodePfSquaredSum *
        TRACE_DENSITY_PORTFOLIO_MAX_PF_SQUARED_GROWTH &&
    (alternative.squaredNodePortPointCount <
      primary.squaredNodePortPointCount * maxConcentrationRatio ||
      stronglyReducesDownstreamPressure)
  )
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
  serializedPortId?: string
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
  PARTIAL_RIP_MIN_ROUTE_COUNT: 100,
  PARTIAL_RIP_MAX_ROUTE_COUNT: 350,
  PARTIAL_RIP_MAX_ATTEMPTS: 7,
  PARTIAL_RIP_WARMUP_FULL_RIP_ATTEMPTS: 1,
  PARTIAL_RIP_COMPLEXITY_SELECTION_MIN_ROUTE_COUNT: 100,
  PARTIAL_RIP_TARGET_MAX_COST_IMPROVEMENT_RATIO: 0.02,
  // Keep the downstream-friendly segment selector, but no longer let it buy
  // simpler topology with a large peak-congestion regression.
  PARTIAL_RIP_MAX_REGION_COST_GROWTH_RATIO: 0.05,
  PARTIAL_RIP_MAX_TOTAL_COST_GROWTH_RATIO: 0.1,
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
    USE_SPARSE_CANDIDATE_STORAGE: false,
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
    USE_SPARSE_CANDIDATE_STORAGE: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: Math.ceil(16 * effortScale),
    MAX_ITERATIONS: Math.ceil(1_000_000 * effortScale),
  }
}

const getTinyHyperGraphPipelineInput = (
  serializedHyperGraph: SerializedHyperGraph,
  effort: number,
  minViaPadDiameter?: number,
  enablePartialRip = true,
  partialRipEligibilityCount?: number,
): TinyHyperGraphSectionPipelineInput => {
  const routeCount = serializedHyperGraph.connections?.length ?? 0
  const eligibilityCount = partialRipEligibilityCount ?? routeCount
  const minPartialRipRouteCount =
    TINY_SOLVE_GRAPH_BASE_OPTIONS.PARTIAL_RIP_MIN_ROUTE_COUNT ?? 0
  const maxPartialRipRouteCount =
    TINY_SOLVE_GRAPH_BASE_OPTIONS.PARTIAL_RIP_MAX_ROUTE_COUNT ??
    Number.POSITIVE_INFINITY
  const enablePartialRipForGraph =
    enablePartialRip &&
    eligibilityCount >= minPartialRipRouteCount &&
    eligibilityCount <= maxPartialRipRouteCount
  return {
    serializedHyperGraph,
    createSectionMask: ({ topology }) => new Int8Array(topology.portCount),
    solveGraphOptions: {
      ...getTinyHyperGraphSolveGraphOptions(effort, minViaPadDiameter),
      ...(enablePartialRipForGraph
        ? {
            PARTIAL_RIP_MIN_ROUTE_COUNT: 0,
            PARTIAL_RIP_MAX_ROUTE_COUNT: Number.POSITIVE_INFINITY,
            PARTIAL_RIP_COMPLEXITY_SELECTION_MIN_ROUTE_COUNT: 0,
          }
        : {
            PARTIAL_RIP_ENABLED: false,
            OUTSIDE_IN_ROUTING: false,
          }),
    },
    sectionSolverOptions: getTinyHyperGraphSectionSolverOptions(
      effort,
      minViaPadDiameter,
    ),
  }
}

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

const capturePreloadedTraceSegmentBaseline = (
  serializedHyperGraph: SerializedHyperGraph,
): PreloadedTraceSegmentBaseline => {
  const segmentKeysByConnectionId = new Map<
    PreloadedTraceConnectionId,
    Set<string>
  >()
  for (const connection of serializedHyperGraph.connections ?? []) {
    if (!hasPreloadedTraceSectionMetadata(connection)) continue
    segmentKeysByConnectionId.set(connection.connectionId, new Set<string>())
  }

  for (const region of serializedHyperGraph.regions) {
    for (const assignment of region.assignments ?? []) {
      const segmentKeys = segmentKeysByConnectionId.get(
        assignment.connectionId as PreloadedTraceConnectionId,
      )
      if (!segmentKeys) continue
      const [firstPortId, secondPortId] = [
        assignment.regionPort1Id,
        assignment.regionPort2Id,
      ].sort()
      segmentKeys.add(
        JSON.stringify([region.regionId, firstPortId, secondPortId]),
      )
    }
  }

  return segmentKeysByConnectionId
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

const restorePreloadedTraceSectionMetadata = (
  loaded: LoadedTinyGraph,
  serializedHyperGraph: SerializedHyperGraph,
): void => {
  const originalSectionByConnectionId = new Map<
    PreloadedTraceConnectionId,
    PreloadedTraceSectionMetadata
  >()
  for (const connection of serializedHyperGraph.connections ?? []) {
    if (!hasPreloadedTraceSectionMetadata(connection)) continue
    originalSectionByConnectionId.set(
      connection.connectionId,
      connection.preloadedTraceSection,
    )
  }
  for (const routeMetadata of loaded.problem.routeMetadata ?? []) {
    const originalSection = originalSectionByConnectionId.get(
      routeMetadata.connectionId as PreloadedTraceConnectionId,
    )
    if (!originalSection) continue
    routeMetadata.preloadedTraceSection = originalSection
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
    if (hasPreloadedTraceSectionMetadata(routeMetadata)) continue
    if (typeof routeMetadata.startRegionId === "string") {
      activeEndpointRegionIds.add(routeMetadata.startRegionId)
    }
    if (typeof routeMetadata.endRegionId === "string") {
      activeEndpointRegionIds.add(routeMetadata.endRegionId)
    }
  }

  for (const routeMetadata of loaded.problem.routeMetadata ?? []) {
    if (!hasPreloadedTraceSectionMetadata(routeMetadata)) continue
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
  let metadataPenaltiesAlreadyLoaded = loaded.problem.portPenalty !== undefined
  for (let portId = 0; portId < loaded.topology.portCount; portId++) {
    const rawPenalty = Number(
      loaded.topology.portMetadata?.[portId]?.tinyHypergraphPortPenalty,
    )
    const metadataPenalty =
      Number.isFinite(rawPenalty) && rawPenalty > 0 ? rawPenalty : 0
    if (metadataPenalty > 0) metadataPortPenaltyCount++
    if (loaded.problem.portPenalty?.[portId] !== metadataPenalty) {
      metadataPenaltiesAlreadyLoaded = false
    }
  }

  if (metadataPenaltiesAlreadyLoaded) {
    loaded.problem.metadataPortPenaltiesApplied = true
    return metadataPortPenaltyCount
  }

  metadataPortPenaltyCount = 0
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
  private readonly selectiveReripSolverClass: typeof SelectiveReripTinyHyperGraphSolver

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
    // Generated routing seeds are ordinary routes that refinement may reopen.
    // Only caller-owned copper needs restoration after a global rerip.
    this.selectiveReripSolverClass =
      this.preloadedPortCount > 0
        ? SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments
        : SelectiveReripTinyHyperGraphSolver
    if (useSelectiveReripRouting) {
      const solveGraphStep = this.pipelineDef.find(
        (pipelineStep) => pipelineStep.solverName === "solveGraph",
      )
      if (!solveGraphStep) {
        throw new Error(
          "Tiny hypergraph pipeline is missing the solveGraph stage",
        )
      }
      solveGraphStep.solverClass = this.selectiveReripSolverClass
    }
    this.MAX_ITERATIONS = getTinyHyperGraphPipelineMaxIterations(inputProblem)
  }

  override loadHyperGraph(serializedHyperGraph: SerializedHyperGraph) {
    const loaded = super.loadHyperGraph(serializedHyperGraph)
    restorePreloadedTraceSectionMetadata(
      loaded,
      this.inputProblem.serializedHyperGraph,
    )
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
    super._step()
    this.configureSolver(this.activeSubSolver)
  }

  override getInitialVisualizationSolver() {
    if (this.useSelectiveReripRouting && !this.initialVisualizationSolver) {
      const { topology, problem } = this.loadHyperGraph(
        this.inputProblem.serializedHyperGraph,
      )
      this.initialVisualizationSolver = new this.selectiveReripSolverClass(
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
}

export class TinyHypergraphPortPointPathingSolver extends BaseSolver {
  private tinyPipelineSolver: TinyHyperGraphSectionPipelineWithTerminalNetIds
  private primaryTinyPipelineSolver?: TinyHyperGraphSectionPipelineWithTerminalNetIds
  private alternativeTinyPipelineSolver?: TinyHyperGraphSectionPipelineWithTerminalNetIds
  private alternativeTinyPipelineInput?: TinyHyperGraphSectionPipelineInput
  private candidatePortfolioPhase: CandidatePortfolioPhase = "primary"
  private primaryCandidateSummary?: DownstreamCandidateSummary
  private alternativeCandidateSummary?: DownstreamCandidateSummary
  private alternativeCandidateEvaluated = false
  private selectedCandidate: "primary" | "alternative" = "primary"
  private duplicateCongestedPortReport?: DuplicateCongestedPortSolverReport
  private duplicateCongestedPortError?: string
  private duplicatedPortCount = 0
  private approximationInput?: SerializedHyperGraph
  private approximationAfterIterationLimit = false
  private refinementIterationsBeforeApproximation = 0
  private inputNodeWithPortPoints: InputNodeWithPortPoints[]
  private originalRegionById: Map<
    CapacityMeshNodeId,
    HgPortPointPathingSolverParams["graph"]["regions"][number]
  >
  private originalRegionIds: Set<CapacityMeshNodeId>
  private rootConnectionNameByConnectionId: Map<string, string | undefined>
  private readonly originalPreloadedSegmentKeysByConnectionId: PreloadedTraceSegmentBaseline

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
    this.originalPreloadedSegmentKeysByConnectionId =
      capturePreloadedTraceSegmentBaseline(serializedGraph)
    const preloadedTraceStats =
      getSerializedPreloadedTraceStats(serializedGraph)
    const hasPreloadedTraceOccupancy =
      preloadedTraceStats.preloadedPortCount > 0
    const usePartialRipRoutingWithPreloadedTraces =
      hasPreloadedTraceOccupancy &&
      params.flags.USE_PARTIAL_RIP_ROUTING_WITH_PRELOADED_TRACES === true
    // A small number of long preloaded routes can occupy as much of the
    // hypergraph as a much larger set of ordinary routes.
    const partialRipEligibilityCount = usePartialRipRoutingWithPreloadedTraces
      ? Math.max(
          serializedGraph.connections?.length ?? 0,
          preloadedTraceStats.preloadedAssignmentCount,
        )
      : undefined
    if (
      params.flags.USE_SELECTIVE_RERIP_ROUTING === true &&
      !hasPreloadedTraceOccupancy
    ) {
      this.approximationInput = serializedGraph
    }
    const shouldRunDuplicateCongestedPortPrepass =
      connections.length <= MAX_CONNECTIONS_FOR_DUPLICATE_CONGESTED_PORT_PREPASS
    let graphForTiny = serializedGraph
    if (shouldRunDuplicateCongestedPortPrepass) {
      const duplicateCongestedPortSolver = new DuplicateCongestedPortSolver(
        serializedGraph,
        {
          duplicatePortProximity: 0.05,
          useSerializedPortPenalties: false,
          routeSolveOptions: {
            ...getTinyViaSizeOptions(params.minViaPadDiameter),
            USE_SPARSE_CANDIDATE_STORAGE: false,
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
        for (const port of graphForTiny.ports) {
          const metadata = asTinyPortMetadata(port.d)
          if (typeof metadata.duplicatedFromPortId !== "string") continue
          delete metadata._preloadedFixedNetIds
          delete metadata._preloadedTracePortAssignments
        }
      }
    } else {
      this.duplicateCongestedPortError = `Skipped for ${connections.length} connections`
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
      !hasPreloadedTraceOccupancy || usePartialRipRoutingWithPreloadedTraces,
      partialRipEligibilityCount,
    )
    this.tinyPipelineSolver =
      new TinyHyperGraphSectionPipelineWithTerminalNetIds(
        tinyPipelineInput,
        params.flags.USE_SELECTIVE_RERIP_ROUTING === true,
      )
    this.primaryTinyPipelineSolver = this.tinyPipelineSolver
    if (
      connections.length >= TRACE_DENSITY_PORTFOLIO_MIN_ROUTE_COUNT &&
      connections.length <= TRACE_DENSITY_PORTFOLIO_MAX_ROUTE_COUNT
    ) {
      this.alternativeTinyPipelineInput = {
        ...tinyPipelineInput,
        solveGraphOptions: {
          ...tinyPipelineInput.solveGraphOptions,
          TRACE_DENSITY_COST_FACTOR: 1,
        },
      }
    }
    this.MAX_ITERATIONS =
      getTinyHyperGraphPipelineMaxIterations(tinyPipelineInput) *
      (this.alternativeTinyPipelineInput ? 2 : 1)

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

  private getChangedPreloadedRouteIds(
    solvedTinySolver: TinyHyperGraphSolver,
  ): Set<number> {
    const routeIdByConnectionId = new Map<PreloadedTraceConnectionId, number>()
    const solvedSegmentKeysByRouteId = new Map<number, Set<string>>()

    for (
      let routeId = 0;
      routeId < solvedTinySolver.problem.routeCount;
      routeId++
    ) {
      const routeMetadata = this.getRouteMetadata(solvedTinySolver, routeId)
      if (!hasPreloadedTraceSectionMetadata(routeMetadata)) continue
      routeIdByConnectionId.set(routeMetadata.connectionId, routeId)
      solvedSegmentKeysByRouteId.set(routeId, new Set<string>())
    }

    for (
      let regionId = 0;
      regionId < solvedTinySolver.state.regionSegments.length;
      regionId++
    ) {
      const serializedRegionId =
        solvedTinySolver.topology.regionMetadata?.[regionId]?.serializedRegionId
      for (const [routeId, fromPortId, toPortId] of solvedTinySolver.state
        .regionSegments[regionId] ?? []) {
        const segmentKeys = solvedSegmentKeysByRouteId.get(routeId)
        if (!segmentKeys) continue
        const fromSerializedPortId =
          solvedTinySolver.topology.portMetadata?.[fromPortId]?.serializedPortId
        const toSerializedPortId =
          solvedTinySolver.topology.portMetadata?.[toPortId]?.serializedPortId
        if (
          typeof serializedRegionId !== "string" ||
          typeof fromSerializedPortId !== "string" ||
          typeof toSerializedPortId !== "string"
        ) {
          throw new Error(
            `Tiny hypergraph preloaded route ${routeId} has a segment without serialized topology IDs`,
          )
        }
        const [firstPortId, secondPortId] = [
          fromSerializedPortId,
          toSerializedPortId,
        ].sort()
        segmentKeys.add(
          JSON.stringify([serializedRegionId, firstPortId, secondPortId]),
        )
      }
    }

    const changedPreloadedRouteIds = new Set<number>()
    for (const [connectionId, initialKeys] of this
      .originalPreloadedSegmentKeysByConnectionId) {
      const routeId = routeIdByConnectionId.get(connectionId)
      if (routeId === undefined) {
        throw new Error(
          `Tiny hypergraph lost preloaded trace section "${connectionId}"`,
        )
      }
      const solvedKeys = solvedSegmentKeysByRouteId.get(routeId)!
      if (initialKeys.size > 0 && solvedKeys.size === 0) {
        throw new Error(
          `Tiny hypergraph lost preloaded trace section "${connectionId}"`,
        )
      }
      if (
        initialKeys.size !== solvedKeys.size ||
        [...initialKeys].some((key) => !solvedKeys.has(key))
      ) {
        changedPreloadedRouteIds.add(routeId)
      }
    }

    return changedPreloadedRouteIds
  }

  private summarizePipelineCandidate(
    pipeline: TinyHyperGraphSectionPipelineWithTerminalNetIds,
  ): DownstreamCandidateSummary {
    const solvedTinySolver = pipeline.getSolvedTinySolver()
    let nodePfSum = 0
    let nodePfSquaredSum = 0
    let nodePfMax = 0
    let squaredNodePortPointCount = 0
    let segmentCount = 0
    let layerChangeCount = 0
    const regionMetadata = solvedTinySolver.topology.regionMetadata ?? []

    for (
      let regionId = 0;
      regionId < solvedTinySolver.state.regionSegments.length;
      regionId++
    ) {
      const segments = solvedTinySolver.state.regionSegments[regionId]
      segmentCount += segments.length
      for (const [, fromPortId, toPortId] of segments) {
        if (
          solvedTinySolver.topology.portZ[fromPortId] !==
          solvedTinySolver.topology.portZ[toPortId]
        ) {
          layerChangeCount += 1
        }
      }

      const originalRegionId = regionMetadata[regionId]?.capacityMeshNodeId
      if (!originalRegionId || !this.originalRegionIds.has(originalRegionId)) {
        continue
      }
      const originalRegion = this.originalRegionById.get(originalRegionId)
      if (!originalRegion || segments.length === 0) continue

      const portPointsInPairs = segments.map(
        ([routeId, fromPortId, toPortId]) =>
          [
            this.createAssignedPortPoint(solvedTinySolver, routeId, fromPortId),
            this.createAssignedPortPoint(solvedTinySolver, routeId, toPortId),
          ] satisfies [PortPoint, PortPoint],
      )
      const solvedNode: NodeWithPortPoints = {
        capacityMeshNodeId: originalRegion.d.capacityMeshNodeId,
        center: originalRegion.d.center,
        width: originalRegion.d.width,
        height: originalRegion.d.height,
        portPoints: portPointsInPairs.flat(),
        portPointsInPairs,
        availableZ: originalRegion.d.availableZ,
      }
      const crossings = getIntraNodeCrossingsUsingCircle(solvedNode)
      const nodePf = calculateNodeProbabilityOfFailure(
        originalRegion.d,
        crossings.numSameLayerCrossings,
        crossings.numEntryExitLayerChanges,
        crossings.numTransitionPairCrossings,
      )
      nodePfSum += nodePf
      nodePfSquaredSum += nodePf * nodePf
      nodePfMax = Math.max(nodePfMax, nodePf)
      squaredNodePortPointCount += solvedNode.portPoints.length ** 2
    }

    return {
      nodePfSum,
      nodePfSquaredSum,
      nodePfMax,
      squaredNodePortPointCount,
      segmentCount,
      layerChangeCount,
      changedPreloadedTraceSectionCount:
        this.getChangedPreloadedRouteIds(solvedTinySolver).size,
    }
  }

  private shouldEvaluateAlternative(summary: DownstreamCandidateSummary) {
    const routeCount =
      this.primaryTinyPipelineSolver!.getSolvedTinySolver().problem.routeCount
    return (
      this.alternativeTinyPipelineInput !== undefined &&
      shouldEvaluateTraceDensityAlternative(summary, routeCount)
    )
  }

  private shouldSelectAlternative(
    primary: DownstreamCandidateSummary,
    alternative: DownstreamCandidateSummary,
  ) {
    const routeCount =
      this.primaryTinyPipelineSolver!.getSolvedTinySolver().problem.routeCount
    return shouldSelectTraceDensityAlternative(primary, alternative, routeCount)
  }

  private finishCandidatePortfolio() {
    this.candidatePortfolioPhase = "complete"
    this.solved = this.tinyPipelineSolver.solved
    this.failed = this.tinyPipelineSolver.failed
    this.error = this.tinyPipelineSolver.error ?? null
  }

  getSolveGraphBenchmarkMetrics() {
    const solveGraphSolver =
      this.tinyPipelineSolver.getSolver<TinyHyperGraphSolver>("solveGraph")
    if (!solveGraphSolver) return undefined

    const regionSegmentCounts = solveGraphSolver.state.regionSegments.map(
      (segments) => segments.length,
    )
    const selectedCandidateSummary =
      this.selectedCandidate === "alternative"
        ? this.alternativeCandidateSummary
        : this.primaryCandidateSummary
    const solveGraphStats = solveGraphSolver.stats
    const solveGraphStageStats =
      this.tinyPipelineSolver.getStageStats().solveGraph

    return {
      routeCount: solveGraphSolver.problem.routeCount,
      traceDensityCandidateEvaluated: this.alternativeCandidateEvaluated,
      traceDensityCandidateSelected: this.selectedCandidate === "alternative",
      downstreamNodePfSum: selectedCandidateSummary?.nodePfSum,
      downstreamNodePfSquaredSum: selectedCandidateSummary?.nodePfSquaredSum,
      downstreamNodePfMax: selectedCandidateSummary?.nodePfMax,
      downstreamSquaredNodePortPointCount:
        selectedCandidateSummary?.squaredNodePortPointCount,
      changedPreloadedTraceSectionCount:
        selectedCandidateSummary?.changedPreloadedTraceSectionCount,
      iterations: solveGraphSolver.iterations,
      timeMs: solveGraphStageStats?.timeSpent,
      ripCount: solveGraphStats.ripCount,
      partialRipCount: solveGraphStats.partialRipCount,
      partiallyRippedRouteCount: solveGraphStats.partiallyRippedRouteCount,
      partiallyRippedSegmentCount: solveGraphStats.partiallyRippedSegmentCount,
      retainedPartialRipSegmentCount:
        solveGraphStats.retainedPartialRipSegmentCount,
      firstMaxRegionCost: solveGraphStats.firstMaxRegionCost,
      bestMaxRegionCost: solveGraphStats.bestMaxRegionCost,
      firstTotalRegionCost: solveGraphStats.firstTotalRegionCost,
      bestTotalRegionCost: solveGraphStats.bestTotalRegionCost,
      firstSegmentCount: solveGraphStats.firstSegmentCount,
      bestSolvedSegmentCount: solveGraphStats.bestSolvedSegmentCount,
      bestSolvedMaxRegionSegmentCount:
        solveGraphStats.bestSolvedMaxRegionSegmentCount,
      bestSolvedSquaredRegionSegmentCount:
        solveGraphStats.bestSolvedSquaredRegionSegmentCount,
      finalMaxRegionSegmentCount: Math.max(0, ...regionSegmentCounts),
      finalSquaredRegionSegmentCount: regionSegmentCounts.reduce(
        (sum, count) => sum + count * count,
        0,
      ),
      finalSegmentCount: selectedCandidateSummary?.segmentCount,
      finalLayerChangeCount: selectedCandidateSummary?.layerChangeCount,
      warmupFullRipAttempts: solveGraphStats.partialRipWarmupFullRipAttempts,
      complexityAwareSelection:
        solveGraphStats.partialRipComplexityAwareSelection,
      targetReached: solveGraphStats.partialRipTargetReached,
      outsideInCompletedRouteCount:
        solveGraphStats.outsideInCompletedRouteCount,
      outsideInFallbackRouteCount: solveGraphStats.outsideInFallbackRouteCount,
      outsideInForwardExpansionCount:
        solveGraphStats.outsideInForwardExpansionCount,
      outsideInReverseExpansionCount:
        solveGraphStats.outsideInReverseExpansionCount,
    }
  }

  private startFinalApproximation(): void {
    const graph = this.approximationInput
    const solveGraph =
      this.tinyPipelineSolver.getSolver<TinyHyperGraphSolver>("solveGraph")
    if (
      !graph ||
      this.candidatePortfolioPhase !== "primary" ||
      !solveGraph?.failed ||
      solveGraph.iterations < solveGraph.MAX_ITERATIONS ||
      solveGraph.error !== `${solveGraph.getSolverName()} ran out of iterations`
    ) {
      return
    }

    // The refinement budget expired without a complete candidate. Independent
    // distance-aware paths provide a compact, complete final approximation.
    // Structural errors still fail, and caller-owned copper is never replaced.
    this.approximationInput = undefined
    this.refinementIterationsBeforeApproximation = solveGraph.iterations
    const allocator = new DuplicateCongestedPortSolver(graph, {
      duplicatePortProximity: 0.05,
      useSerializedPortPenalties: false,
      createInitialAssignments: true,
      routeSolveOptions: {
        ...getTinyViaSizeOptions(this.params.minViaPadDiameter),
        MAX_ITERATIONS: Math.ceil(
          2_000_000 * getEffortScale(this.params.effort),
        ),
        STATIC_REACHABILITY_PRECHECK: true,
      },
    })
    allocator.solve()
    if (allocator.failed) {
      throw new Error(`Cannot create final approximation: ${allocator.error}`)
    }
    const approximation = allocator.getOutput()
    const input = getTinyHyperGraphPipelineInput(
      { ...approximation, solvedRoutes: graph.solvedRoutes },
      this.params.effort,
      this.params.minViaPadDiameter,
    )
    // One iteration records the complete seed for normal timeout acceptance.
    input.solveGraphOptions = {
      ...input.solveGraphOptions,
      MAX_ITERATIONS: 1,
    }
    this.tinyPipelineSolver =
      new TinyHyperGraphSectionPipelineWithTerminalNetIds(input, true)
    this.primaryTinyPipelineSolver = this.tinyPipelineSolver
    this.alternativeTinyPipelineInput = undefined
    this.duplicateCongestedPortReport = allocator.report
    this.duplicateCongestedPortError = undefined
    this.duplicatedPortCount = allocator.report.duplicatedPorts.reduce(
      (sum, port) => sum + port.duplicatePortIds.length,
      0,
    )
    this.inputNodeWithPortPoints = buildInputNodesWithPortPoints(
      this.params,
      approximation,
    )
    this.approximationAfterIterationLimit = true
  }

  _step() {
    this.tinyPipelineSolver.step()
    if (this.tinyPipelineSolver.failed) {
      this.startFinalApproximation()
    }

    if (
      this.candidatePortfolioPhase === "primary" &&
      this.primaryTinyPipelineSolver!.failed
    ) {
      this.alternativeTinyPipelineInput = undefined
      this.finishCandidatePortfolio()
    } else if (
      this.candidatePortfolioPhase === "primary" &&
      this.primaryTinyPipelineSolver!.solved
    ) {
      this.primaryCandidateSummary = this.summarizePipelineCandidate(
        this.primaryTinyPipelineSolver!,
      )
      if (this.shouldEvaluateAlternative(this.primaryCandidateSummary)) {
        this.alternativeCandidateEvaluated = true
        this.alternativeTinyPipelineSolver =
          new TinyHyperGraphSectionPipelineWithTerminalNetIds(
            this.alternativeTinyPipelineInput!,
            this.params.flags.USE_SELECTIVE_RERIP_ROUTING === true,
          )
        this.tinyPipelineSolver = this.alternativeTinyPipelineSolver
        this.candidatePortfolioPhase = "alternative"
      } else {
        this.alternativeTinyPipelineInput = undefined
        this.finishCandidatePortfolio()
      }
    } else if (
      this.candidatePortfolioPhase === "alternative" &&
      (this.tinyPipelineSolver.solved || this.tinyPipelineSolver.failed)
    ) {
      if (this.tinyPipelineSolver.solved && !this.tinyPipelineSolver.failed) {
        this.alternativeCandidateSummary = this.summarizePipelineCandidate(
          this.tinyPipelineSolver,
        )
      }
      if (
        this.alternativeCandidateSummary &&
        this.primaryCandidateSummary &&
        this.shouldSelectAlternative(
          this.primaryCandidateSummary,
          this.alternativeCandidateSummary,
        )
      ) {
        this.selectedCandidate = "alternative"
        this.primaryTinyPipelineSolver = undefined
        this.alternativeTinyPipelineSolver = undefined
      } else {
        this.tinyPipelineSolver = this.primaryTinyPipelineSolver!
        this.alternativeTinyPipelineSolver = undefined
      }
      this.alternativeTinyPipelineInput = undefined
      this.finishCandidatePortfolio()
    }

    const optimizeSectionSolver =
      this.tinyPipelineSolver.getSolver<TinyHyperGraphSectionSolver>(
        "optimizeSection",
      )
    const currentTinySolver = this.getCurrentTinySolver()

    this.solved =
      this.candidatePortfolioPhase === "complete" &&
      this.tinyPipelineSolver.solved
    this.failed =
      this.candidatePortfolioPhase === "complete" &&
      this.tinyPipelineSolver.failed
    this.error = this.failed ? (this.tinyPipelineSolver.error ?? null) : null
    this.progress =
      this.candidatePortfolioPhase === "complete"
        ? 1
        : this.candidatePortfolioPhase === "alternative"
          ? 0.5 + this.tinyPipelineSolver.progress * 0.5
          : this.alternativeTinyPipelineInput
            ? this.tinyPipelineSolver.progress * 0.5
            : this.tinyPipelineSolver.progress
    this.stats = {
      approximationAfterIterationLimit: this.approximationAfterIterationLimit,
      refinementIterationsBeforeApproximation:
        this.refinementIterationsBeforeApproximation,
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
      candidatePortfolioPhase: this.candidatePortfolioPhase,
      candidatePortfolioSelectedCandidate: this.selectedCandidate,
      candidatePortfolioPrimarySummary: this.primaryCandidateSummary,
      candidatePortfolioAlternativeSummary: this.alternativeCandidateSummary,
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
      ? (this.rootConnectionNameByConnectionId.get(
          routeMetadata.connectionId,
        ) ?? routeMetadata.mutuallyConnectedNetworkId)
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
    changedPreloadedTraceSections: ChangedPreloadedTraceSection[]
  } {
    const solvedTinySolver = this.getSolvedTinySolver()
    const nodesWithPortPoints: NodeWithPortPoints[] = []
    const regionSegments = solvedTinySolver.state.regionSegments
    const regionMetadata = solvedTinySolver.topology.regionMetadata ?? []
    const changedPreloadedRouteIds =
      this.getChangedPreloadedRouteIds(solvedTinySolver)

    for (let regionId = 0; regionId < regionSegments.length; regionId++) {
      const originalRegionId = regionMetadata[regionId]?.capacityMeshNodeId
      if (!originalRegionId || !this.originalRegionIds.has(originalRegionId)) {
        continue
      }

      const originalRegion = this.originalRegionById.get(originalRegionId)
      if (!originalRegion) continue

      const portPointsInPairs = regionSegments[regionId]
        .filter(([routeId]) => {
          const routeMetadata = this.getRouteMetadata(solvedTinySolver, routeId)
          return (
            !hasPreloadedTraceSectionMetadata(routeMetadata) ||
            changedPreloadedRouteIds.has(routeId)
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

    const changedPreloadedTraceSections = [...changedPreloadedRouteIds].map(
      (routeId): ChangedPreloadedTraceSection => {
        const routeMetadata = this.getRouteMetadata(solvedTinySolver, routeId)
        if (!hasPreloadedTraceSectionMetadata(routeMetadata)) {
          throw new Error(
            `Changed preloaded hypergraph route ${routeId} is missing section metadata`,
          )
        }
        const section = routeMetadata.preloadedTraceSection
        return {
          connectionName: routeMetadata.connectionId,
          traceId: section.traceId,
          startRoutePosition: section.startRoutePosition,
          endRoutePosition: section.endRoutePosition,
          connection: {
            name: routeMetadata.connectionId,
            __rootConnectionNames: [routeMetadata.mutuallyConnectedNetworkId],
            pointsToConnect: [
              {
                x: section.startPoint.x,
                y: section.startPoint.y,
                layer: mapZToLayerName(
                  section.startPoint.z,
                  this.params.layerCount,
                ),
              },
              {
                x: section.endPoint.x,
                y: section.endPoint.y,
                layer: mapZToLayerName(
                  section.endPoint.z,
                  this.params.layerCount,
                ),
              },
            ],
          },
        }
      },
    )
    this.stats.changedPreloadedTraceSectionCount =
      changedPreloadedTraceSections.length

    return {
      nodesWithPortPoints,
      inputNodeWithPortPoints: this.inputNodeWithPortPoints,
      changedPreloadedTraceSections,
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
