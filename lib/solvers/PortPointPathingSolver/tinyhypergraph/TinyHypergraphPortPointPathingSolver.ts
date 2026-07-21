import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { pointToBoxDistance } from "@tscircuit/math-utils"
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
  createEmptyRegionIntersectionCache,
  DuplicateCongestedPortSolver,
  orderConnectionsByNetCardinality,
  orderRoutesAfterSelectiveRerip,
  SelectiveReripTinyHyperGraphSolver,
  type Candidate,
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

type RouteMetadata = {
  connectionId: string
  mutuallyConnectedNetworkId?: string
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
  serializedRegionId?: string
  bounds?: TinyBounds
  center?: { x: number; y: number }
  width?: number
  height?: number
  availableZ?: number[]
  _qfpRegionType?: InputNodeWithPortPoints["_qfpRegionType"]
  _isNarrowQfpPadGap?: boolean
  _offBoardConnectionId?: string
  _tinyTargetAttachmentBridge?: boolean
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
const TINY_TERMINAL_VIA_BRIDGE_PORT_PREFIX = "tiny-terminal:via-bridge-port:"
const TINY_TARGET_ATTACHMENT_BRIDGE_REGION_PREFIX =
  "tiny-target-attachment-bridge-region:"
const TERMINAL_REGION_CONTAINMENT_TOLERANCE = 1e-3
const TERMINAL_VIA_ROUTING_MARGIN = 0.15
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
const MAX_CONNECTIONS_FOR_DUPLICATE_CONGESTED_PORT_PREPASS = 500

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
  routeMetadata.simpleRouteConnection?.__rootConnectionNames?.[0] ??
  routeMetadata.mutuallyConnectedNetworkId

const getTinyRouteConnectionNetId = (connection: TinyRouteConnection): string =>
  connection.simpleRouteConnection?.__rootConnectionNames?.[0] ??
  connection.mutuallyConnectedNetworkId ??
  connection.connectionId

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

const getViaHostPlacement = (params: {
  connection: TinyRouteConnection
  startPoint: ReturnType<typeof getRoutePoint>
  endPoint: ReturnType<typeof getRoutePoint>
  startZ: number
  endZ: number
  minViaPadDiameter: number
  routeNetIndex: number
  regionNetIdByRegionId: Map<string, number>
}):
  | {
      region: TinyRouteConnection["startRegion"]
      point: { x: number; y: number }
    }
  | undefined => {
  const { connection, startPoint, endPoint, startZ, endZ } = params
  if (!startPoint || !endPoint || startZ === endZ) return undefined

  for (const region of [connection.startRegion, connection.endRegion]) {
    const halfWidth = region.d.width / 2
    const halfHeight = region.d.height / 2
    const containsStart =
      pointToBoxDistance(startPoint, region.d) <=
      TERMINAL_REGION_CONTAINMENT_TOLERANCE
    const containsEnd =
      pointToBoxDistance(endPoint, region.d) <=
      TERMINAL_REGION_CONTAINMENT_TOLERANCE
    const canFitVia =
      region.d.width + TERMINAL_REGION_CONTAINMENT_TOLERANCE >=
        params.minViaPadDiameter &&
      region.d.height + TERMINAL_REGION_CONTAINMENT_TOLERANCE >=
        params.minViaPadDiameter
    const viaMargin = params.minViaPadDiameter / 2 + TERMINAL_VIA_ROUTING_MARGIN
    const minViaX = region.d.center.x - halfWidth + viaMargin
    const maxViaX = region.d.center.x + halfWidth - viaMargin
    const minViaY = region.d.center.y - halfHeight + viaMargin
    const maxViaY = region.d.center.y + halfHeight - viaMargin
    const midpointX = (startPoint.x + endPoint.x) / 2
    const midpointY = (startPoint.y + endPoint.y) / 2
    const viaX =
      minViaX <= maxViaX
        ? Math.min(maxViaX, Math.max(minViaX, midpointX))
        : midpointX
    const viaY =
      minViaY <= maxViaY
        ? Math.min(maxViaY, Math.max(minViaY, midpointY))
        : midpointY
    const viaIsInsideBothTerminalRegions = [
      connection.startRegion,
      connection.endRegion,
    ].every(
      (terminalRegion) =>
        pointToBoxDistance({ x: viaX, y: viaY }, terminalRegion.d) <=
        TERMINAL_REGION_CONTAINMENT_TOLERANCE,
    )
    const isReservedForRoute =
      params.regionNetIdByRegionId.get(region.regionId) === params.routeNetIndex

    if (
      containsStart &&
      containsEnd &&
      canFitVia &&
      viaIsInsideBothTerminalRegions &&
      isReservedForRoute
    ) {
      return { region, point: { x: viaX, y: viaY } }
    }
  }

  return undefined
}

const getOverlappingRegionViaPlacement = (params: {
  firstRegion: TinyRouteConnection["startRegion"]
  secondRegion: TinyRouteConnection["startRegion"]
  minViaPadDiameter: number
}):
  | {
      region: TinyRouteConnection["startRegion"]
      point: { x: number; y: number }
      bridgeZ: number
    }
  | undefined => {
  const { firstRegion, secondRegion } = params
  const firstZ = firstRegion.d.availableZ[0]
  const secondZ = secondRegion.d.availableZ[0]
  if (
    firstZ === undefined ||
    secondZ === undefined ||
    firstRegion.d.availableZ.some((z) => secondRegion.d.availableZ.includes(z))
  ) {
    return undefined
  }

  const overlapMinX = Math.max(
    firstRegion.d.center.x - firstRegion.d.width / 2,
    secondRegion.d.center.x - secondRegion.d.width / 2,
  )
  const overlapMaxX = Math.min(
    firstRegion.d.center.x + firstRegion.d.width / 2,
    secondRegion.d.center.x + secondRegion.d.width / 2,
  )
  const overlapMinY = Math.max(
    firstRegion.d.center.y - firstRegion.d.height / 2,
    secondRegion.d.center.y - secondRegion.d.height / 2,
  )
  const overlapMaxY = Math.min(
    firstRegion.d.center.y + firstRegion.d.height / 2,
    secondRegion.d.center.y + secondRegion.d.height / 2,
  )
  if (
    overlapMinX > overlapMaxX + TERMINAL_REGION_CONTAINMENT_TOLERANCE ||
    overlapMinY > overlapMaxY + TERMINAL_REGION_CONTAINMENT_TOLERANCE
  ) {
    return undefined
  }

  for (const [region, bridgeZ] of [
    [firstRegion, secondZ],
    [secondRegion, firstZ],
  ] as const) {
    if (
      region.d.width + TERMINAL_REGION_CONTAINMENT_TOLERANCE <
        params.minViaPadDiameter ||
      region.d.height + TERMINAL_REGION_CONTAINMENT_TOLERANCE <
        params.minViaPadDiameter
    ) {
      continue
    }

    const viaMargin = params.minViaPadDiameter / 2 + TERMINAL_VIA_ROUTING_MARGIN
    const minViaX = Math.max(
      overlapMinX,
      region.d.center.x - region.d.width / 2 + viaMargin,
    )
    const maxViaX = Math.min(
      overlapMaxX,
      region.d.center.x + region.d.width / 2 - viaMargin,
    )
    const minViaY = Math.max(
      overlapMinY,
      region.d.center.y - region.d.height / 2 + viaMargin,
    )
    const maxViaY = Math.min(
      overlapMaxY,
      region.d.center.y + region.d.height / 2 - viaMargin,
    )
    const overlapCenterX = (overlapMinX + overlapMaxX) / 2
    const overlapCenterY = (overlapMinY + overlapMaxY) / 2
    const viaX =
      minViaX <= maxViaX
        ? Math.min(maxViaX, Math.max(minViaX, overlapCenterX))
        : overlapCenterX
    const viaY =
      minViaY <= maxViaY
        ? Math.min(maxViaY, Math.max(minViaY, overlapCenterY))
        : overlapCenterY
    const isInsideBothRegions = [firstRegion, secondRegion].every(
      (candidateRegion) =>
        pointToBoxDistance({ x: viaX, y: viaY }, candidateRegion.d) <=
        TERMINAL_REGION_CONTAINMENT_TOLERANCE,
    )
    if (isInsideBothRegions) {
      return { region, point: { x: viaX, y: viaY }, bridgeZ }
    }
  }

  return undefined
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
    return { ...connection, simpleRouteConnection }
  })
}

const getRegionPairKey = (firstRegionId: string, secondRegionId: string) =>
  firstRegionId < secondRegionId
    ? `${firstRegionId}\u0000${secondRegionId}`
    : `${secondRegionId}\u0000${firstRegionId}`

type TinyConnectionLayerInfo = {
  connection: TinyRouteConnection
  netId: number
  startZ: number
  endZ: number
}

type PendingTerminalViaBridge = TinyConnectionLayerInfo & {
  placement: NonNullable<ReturnType<typeof getViaHostPlacement>>
}

const getUnreachableConnectionIds = (params: {
  connectionLayerInfo: TinyConnectionLayerInfo[]
  regions: SerializedHyperGraph["regions"]
  ports: SerializedHyperGraph["ports"]
}): Set<string> => {
  const regionById = new Map(
    params.regions.map((region) => [region.regionId, region]),
  )
  const incidentPortsByRegionId = new Map<
    string,
    SerializedHyperGraph["ports"]
  >()
  for (const port of params.ports) {
    for (const regionId of [port.region1Id, port.region2Id]) {
      const incidentPorts = incidentPortsByRegionId.get(regionId) ?? []
      incidentPorts.push(port)
      incidentPortsByRegionId.set(regionId, incidentPorts)
    }
  }

  const unreachableConnectionIds = new Set<string>()
  for (const {
    connection,
    netId,
    startZ,
    endZ,
  } of params.connectionLayerInfo) {
    const startRegionId = connection.startRegion.regionId
    const endRegionId = connection.endRegion.regionId
    const queue = [{ regionId: startRegionId, z: startZ }]
    const visited = new Set([`${startRegionId}\u0000${startZ}`])
    let reachable = false

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const { regionId, z } = queue[queueIndex]!
      const region = regionById.get(regionId)
      if (!region || !region.d.availableZ.includes(z)) continue
      if (regionId === endRegionId && region.d.availableZ.includes(endZ)) {
        reachable = true
        break
      }

      const reservedNetId = region.d.netId
      if (reservedNetId !== undefined && reservedNetId !== netId) continue

      for (const port of incidentPortsByRegionId.get(regionId) ?? []) {
        const nextRegionId =
          port.region1Id === regionId ? port.region2Id : port.region1Id
        const nextRegion = regionById.get(nextRegionId)
        if (!nextRegion) continue
        const nextReservedNetId = nextRegion.d.netId
        if (nextReservedNetId !== undefined && nextReservedNetId !== netId) {
          continue
        }
        const portZ = asTinyPortMetadata(port.d).z
        const traversalLayers =
          portZ === undefined
            ? region.d.availableZ.filter((candidateZ: number) =>
                nextRegion.d.availableZ.includes(candidateZ),
              )
            : [portZ]
        for (const traversalZ of traversalLayers) {
          if (
            !region.d.availableZ.includes(traversalZ) ||
            !nextRegion.d.availableZ.includes(traversalZ)
          ) {
            continue
          }
          const stateKey = `${nextRegionId}\u0000${traversalZ}`
          if (visited.has(stateKey)) continue
          visited.add(stateKey)
          queue.push({ regionId: nextRegionId, z: traversalZ })
        }
      }
    }

    if (!reachable) {
      unreachableConnectionIds.add(connection.connectionId)
    }
  }

  return unreachableConnectionIds
}

const addTerminalViaBridge = (params: {
  bridge: PendingTerminalViaBridge
  regions: SerializedHyperGraph["regions"]
  ports: SerializedHyperGraph["ports"]
}) => {
  const { connection, placement, startZ, endZ } = params.bridge
  const serializedViaHostRegion = params.regions.find(
    (region) => region.regionId === placement.region.regionId,
  )
  const startRegion = params.regions.find(
    (region) => region.regionId === connection.startRegion.regionId,
  )
  const endRegion = params.regions.find(
    (region) => region.regionId === connection.endRegion.regionId,
  )
  if (!serializedViaHostRegion || !startRegion || !endRegion) {
    throw new Error(
      `Could not map terminal via bridge regions for "${connection.connectionId}"`,
    )
  }

  serializedViaHostRegion.d.availableZ = [
    ...new Set([...serializedViaHostRegion.d.availableZ, startZ, endZ]),
  ].sort((a, b) => a - b)

  const viaBridgePortId = `${TINY_TERMINAL_VIA_BRIDGE_PORT_PREFIX}${connection.connectionId}`
  const viaBridgeZ =
    placement.region.regionId === connection.startRegion.regionId
      ? endZ
      : startZ
  params.ports.push({
    portId: viaBridgePortId,
    region1Id: connection.startRegion.regionId,
    region2Id: connection.endRegion.regionId,
    d: {
      portId: viaBridgePortId,
      x: placement.point.x,
      y: placement.point.y,
      z: viaBridgeZ,
      distToCentermostPortOnZ: 0,
      _tinyTerminal: true,
    },
  })
  startRegion.pointIds.push(viaBridgePortId)
  endRegion.pointIds.push(viaBridgePortId)
}

const addOverlappingNetViaBridges = (params: {
  input: TinyHypergraphInput
  regions: SerializedHyperGraph["regions"]
  ports: SerializedHyperGraph["ports"]
  regionNetIdByRegionId: Map<string, number>
  netIds: Set<number>
}) => {
  const serializedRegionById = new Map(
    params.regions.map((region) => [region.regionId, region]),
  )
  const connectedRegionPairs = new Set(
    params.ports.map((port) =>
      getRegionPairKey(port.region1Id, port.region2Id),
    ),
  )
  const targetRegionsByNetId = new Map<
    number,
    TinyRouteConnection["startRegion"][]
  >()

  for (const region of params.input.graph.regions) {
    if (!region.d._containsTarget) continue
    const netId = params.regionNetIdByRegionId.get(region.regionId)
    if (netId === undefined || !params.netIds.has(netId)) continue
    const netRegions = targetRegionsByNetId.get(netId) ?? []
    netRegions.push(region)
    targetRegionsByNetId.set(netId, netRegions)
  }

  for (const [netId, netRegions] of targetRegionsByNetId) {
    for (let firstIndex = 0; firstIndex < netRegions.length; firstIndex++) {
      const firstRegion = netRegions[firstIndex]!
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < netRegions.length;
        secondIndex++
      ) {
        const secondRegion = netRegions[secondIndex]!
        const regionPairKey = getRegionPairKey(
          firstRegion.regionId,
          secondRegion.regionId,
        )
        if (connectedRegionPairs.has(regionPairKey)) continue

        const viaPlacement = getOverlappingRegionViaPlacement({
          firstRegion,
          secondRegion,
          minViaPadDiameter: params.input.minViaPadDiameter ?? 0.3,
        })
        if (!viaPlacement) continue

        const serializedFirstRegion = serializedRegionById.get(
          firstRegion.regionId,
        )
        const serializedSecondRegion = serializedRegionById.get(
          secondRegion.regionId,
        )
        const serializedViaHostRegion = serializedRegionById.get(
          viaPlacement.region.regionId,
        )
        if (
          !serializedFirstRegion ||
          !serializedSecondRegion ||
          !serializedViaHostRegion
        ) {
          throw new Error(
            `Could not map overlapping target regions "${firstRegion.regionId}" and "${secondRegion.regionId}"`,
          )
        }

        const viaBridgePortId = `tiny-net-via-bridge-port:${netId}:${firstRegion.regionId}:${secondRegion.regionId}`
        params.ports.push({
          portId: viaBridgePortId,
          region1Id: firstRegion.regionId,
          region2Id: secondRegion.regionId,
          d: {
            portId: viaBridgePortId,
            x: viaPlacement.point.x,
            y: viaPlacement.point.y,
            z: viaPlacement.bridgeZ,
            distToCentermostPortOnZ: 0,
            _tinyTerminal: true,
          },
        })
        serializedFirstRegion.pointIds.push(viaBridgePortId)
        serializedSecondRegion.pointIds.push(viaBridgePortId)
        serializedViaHostRegion.d.availableZ = [
          ...new Set([
            ...serializedViaHostRegion.d.availableZ,
            ...firstRegion.d.availableZ,
            ...secondRegion.d.availableZ,
          ]),
        ].sort((a, b) => a - b)
        connectedRegionPairs.add(regionPairKey)
      }
    }
  }
}

const addOverlappingTargetRegionAttachments = (params: {
  input: TinyHypergraphInput
  regions: SerializedHyperGraph["regions"]
  ports: SerializedHyperGraph["ports"]
  regionNetIdByRegionId: Map<string, number>
  netIds: Set<number>
}) => {
  const serializedRegionById = new Map(
    params.regions.map((region) => [region.regionId, region]),
  )
  const connectedRegionPairs = new Set(
    params.ports.map((port) =>
      getRegionPairKey(port.region1Id, port.region2Id),
    ),
  )

  for (const targetRegion of params.input.graph.regions) {
    if (!targetRegion.d._containsTarget) continue
    const targetNetId = params.regionNetIdByRegionId.get(targetRegion.regionId)
    if (targetNetId === undefined || !params.netIds.has(targetNetId)) continue

    let bestAttachment:
      | {
          candidateRegion: TinyRouteConnection["startRegion"]
          viaPlacement: NonNullable<
            ReturnType<typeof getOverlappingRegionViaPlacement>
          >
          availableZCount: number
          portCount: number
          overlapArea: number
        }
      | undefined
    for (const candidateRegion of params.input.graph.regions) {
      if (
        candidateRegion.regionId === targetRegion.regionId ||
        candidateRegion.d._containsTarget ||
        candidateRegion.d._containsObstacle ||
        candidateRegion.ports.length === 0
      ) {
        continue
      }
      const candidateNetId = params.regionNetIdByRegionId.get(
        candidateRegion.regionId,
      )
      if (candidateNetId !== undefined && candidateNetId !== targetNetId) {
        continue
      }

      const sharedZ = targetRegion.d.availableZ.find((z) =>
        candidateRegion.d.availableZ.includes(z),
      )
      if (sharedZ !== undefined) continue
      const overlapMinX = Math.max(
        targetRegion.d.center.x - targetRegion.d.width / 2,
        candidateRegion.d.center.x - candidateRegion.d.width / 2,
      )
      const overlapMaxX = Math.min(
        targetRegion.d.center.x + targetRegion.d.width / 2,
        candidateRegion.d.center.x + candidateRegion.d.width / 2,
      )
      const overlapMinY = Math.max(
        targetRegion.d.center.y - targetRegion.d.height / 2,
        candidateRegion.d.center.y - candidateRegion.d.height / 2,
      )
      const overlapMaxY = Math.min(
        targetRegion.d.center.y + targetRegion.d.height / 2,
        candidateRegion.d.center.y + candidateRegion.d.height / 2,
      )
      if (
        overlapMaxX - overlapMinX <= TERMINAL_REGION_CONTAINMENT_TOLERANCE ||
        overlapMaxY - overlapMinY <= TERMINAL_REGION_CONTAINMENT_TOLERANCE
      ) {
        continue
      }

      const viaPlacement = getOverlappingRegionViaPlacement({
        firstRegion: targetRegion,
        secondRegion: candidateRegion,
        minViaPadDiameter: params.input.minViaPadDiameter ?? 0.3,
      })
      if (!viaPlacement) continue

      const regionPairKey = getRegionPairKey(
        targetRegion.regionId,
        candidateRegion.regionId,
      )
      if (connectedRegionPairs.has(regionPairKey)) continue

      const overlapArea =
        (overlapMaxX - overlapMinX) * (overlapMaxY - overlapMinY)
      const availableZCount = candidateRegion.d.availableZ.length
      const portCount = candidateRegion.ports.length
      if (
        !bestAttachment ||
        availableZCount > bestAttachment.availableZCount ||
        (availableZCount === bestAttachment.availableZCount &&
          portCount > bestAttachment.portCount) ||
        (availableZCount === bestAttachment.availableZCount &&
          portCount === bestAttachment.portCount &&
          overlapArea > bestAttachment.overlapArea)
      ) {
        bestAttachment = {
          candidateRegion,
          viaPlacement,
          availableZCount,
          portCount,
          overlapArea,
        }
      }
    }

    if (!bestAttachment) continue
    const { candidateRegion, viaPlacement } = bestAttachment
    const regionPairKey = getRegionPairKey(
      targetRegion.regionId,
      candidateRegion.regionId,
    )

    const serializedTargetRegion = serializedRegionById.get(
      targetRegion.regionId,
    )
    const serializedCandidateRegion = serializedRegionById.get(
      candidateRegion.regionId,
    )
    if (!serializedTargetRegion || !serializedCandidateRegion) {
      throw new Error(
        `Could not map overlapping target attachment regions "${targetRegion.regionId}" and "${candidateRegion.regionId}"`,
      )
    }

    const bridgeRegionId = `${TINY_TARGET_ATTACHMENT_BRIDGE_REGION_PREFIX}${targetRegion.regionId}:${candidateRegion.regionId}`
    const targetAttachmentPortId = `tiny-target-attachment-port:${targetRegion.regionId}:${candidateRegion.regionId}:target`
    const candidateAttachmentPortId = `tiny-target-attachment-port:${targetRegion.regionId}:${candidateRegion.regionId}:candidate`
    const targetZ = targetRegion.d.availableZ[0]!
    const candidateZ = candidateRegion.d.availableZ[0]!
    const bridgeSize = params.input.minViaPadDiameter ?? 0.3
    params.regions.push({
      regionId: bridgeRegionId,
      pointIds: [targetAttachmentPortId, candidateAttachmentPortId],
      d: {
        capacityMeshNodeId: bridgeRegionId,
        center: { ...viaPlacement.point },
        width: bridgeSize,
        height: bridgeSize,
        availableZ: [...new Set([targetZ, candidateZ])].sort((a, b) => a - b),
        netId: targetNetId,
        _tinyTargetAttachmentBridge: true,
      },
    })
    params.ports.push({
      portId: targetAttachmentPortId,
      region1Id: targetRegion.regionId,
      region2Id: bridgeRegionId,
      d: {
        portId: targetAttachmentPortId,
        x: viaPlacement.point.x,
        y: viaPlacement.point.y,
        z: targetZ,
        distToCentermostPortOnZ: 0,
        _tinyTerminal: true,
      },
    })
    params.ports.push({
      portId: candidateAttachmentPortId,
      region1Id: bridgeRegionId,
      region2Id: candidateRegion.regionId,
      d: {
        portId: candidateAttachmentPortId,
        x: viaPlacement.point.x,
        y: viaPlacement.point.y,
        z: candidateZ,
        distToCentermostPortOnZ: 0,
        _tinyTerminal: true,
      },
    })
    serializedTargetRegion.pointIds.push(targetAttachmentPortId)
    serializedCandidateRegion.pointIds.push(candidateAttachmentPortId)
    connectedRegionPairs.add(regionPairKey)
  }
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
      mutuallyConnectedNetworkId:
        connection.mutuallyConnectedNetworkId ?? connection.connectionId,
      startRegionId: connection.startRegion.regionId,
      endRegionId: connection.endRegion.regionId,
      simpleRouteConnection: connection.simpleRouteConnection,
    }),
  )
  const solvedRoutes: SerializedTinySolvedRoute[] = []
  const connectionLayerInfo: TinyConnectionLayerInfo[] = []
  const pendingTerminalViaBridges = new Map<string, PendingTerminalViaBridge>()
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
    const layerInfo: TinyConnectionLayerInfo = {
      connection,
      netId: routeNetIndex,
      startZ,
      endZ,
    }
    connectionLayerInfo.push(layerInfo)

    // When opposite-layer pads overlap inside one same-net target region,
    // remember a legal local bridge. It is added only if the unmodified graph
    // has no layer-aware path for this route.
    const viaHostPlacement = params.preserveTerminalPcbPortIds
      ? getViaHostPlacement({
          connection,
          startPoint,
          endPoint,
          startZ,
          endZ,
          minViaPadDiameter: params.minViaPadDiameter ?? 0.3,
          routeNetIndex,
          regionNetIdByRegionId,
        })
      : undefined
    if (viaHostPlacement) {
      pendingTerminalViaBridges.set(connection.connectionId, {
        ...layerInfo,
        placement: viaHostPlacement,
      })
    }

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

  // Pipeline 7 preserves PCB terminal identities for downstream stitching.
  // Add cross-layer topology only for routes that are actually disconnected,
  // preserving path selection for healthy routes and for other pipelines.
  if (params.preserveTerminalPcbPortIds) {
    const graphUnreachableConnectionIds = getUnreachableConnectionIds({
      connectionLayerInfo,
      regions,
      ports,
    })
    if (graphUnreachableConnectionIds.size > 0) {
      const unreachableNetIds = new Set(
        connectionLayerInfo
          .filter(({ connection }) =>
            graphUnreachableConnectionIds.has(connection.connectionId),
          )
          .map(({ netId }) => netId),
      )
      for (const bridge of pendingTerminalViaBridges.values()) {
        if (
          !graphUnreachableConnectionIds.has(bridge.connection.connectionId)
        ) {
          continue
        }
        addTerminalViaBridge({ bridge, regions, ports })
      }

      addOverlappingNetViaBridges({
        input: params,
        regions,
        ports,
        regionNetIdByRegionId,
        netIds: unreachableNetIds,
      })
      addOverlappingTargetRegionAttachments({
        input: params,
        regions,
        ports,
        regionNetIdByRegionId,
        netIds: unreachableNetIds,
      })
    }
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
      availableZ: serializedRegion?.d.availableZ ?? region.d.availableZ,
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

class SelectiveReripTinyHyperGraphSolverWithViaBridges extends SelectiveReripTinyHyperGraphSolver {
  private readonly cycleRouteIds = new Set<number>()
  private selectiveReripCycleEscapeCount = 0

  override _setup() {
    super._setup()
    if (!this.failed) {
      this.seedViaBridgeRoutes()
    }
  }

  override resetRoutingStateForRerip() {
    super.resetRoutingStateForRerip()
    this.seedViaBridgeRoutes()
  }

  override _step(): void {
    const ripCountBeforeStep = this.state.ripCount
    super._step()
    if (this.state.ripCount !== ripCountBeforeStep) {
      this.seedViaBridgeRoutes()
    }
  }

  override onOutOfCandidates(): void {
    const failedRouteId = this.state.currentRouteId
    const reripStats = this.getSelectiveReripStats()
    const previousFailedRouteId = reripStats.lastFailedRouteId
    const previousFailureRippedCurrentRoute =
      failedRouteId !== undefined &&
      reripStats.lastRippedRouteIds.includes(failedRouteId)
    const repeatedDirectOwnerRouteIds =
      failedRouteId === undefined
        ? []
        : reripStats.failedOwnerPairs
            .filter(
              (pair) => pair.failedRouteId === failedRouteId && pair.count >= 2,
            )
            .map((pair) => pair.ownerRouteId)

    if (
      failedRouteId !== undefined &&
      previousFailedRouteId !== undefined &&
      previousFailedRouteId !== failedRouteId &&
      previousFailureRippedCurrentRoute &&
      repeatedDirectOwnerRouteIds.length > 0
    ) {
      const directPath = this.findRelaxedBlockerPath()
      if (
        directPath.found &&
        repeatedDirectOwnerRouteIds.some((routeId) =>
          directPath.owners.has(routeId),
        )
      ) {
        const detectedCycleRouteIds = [
          failedRouteId,
          ...reripStats.lastRippedRouteIds,
          ...directPath.owners,
          previousFailedRouteId,
        ]
        if (
          this.cycleRouteIds.size > 0 &&
          !detectedCycleRouteIds.some((routeId) =>
            this.cycleRouteIds.has(routeId),
          )
        ) {
          this.cycleRouteIds.clear()
        }
        for (const routeId of detectedCycleRouteIds) {
          this.cycleRouteIds.add(routeId)
        }
        const rippedRouteIds = new Set(this.cycleRouteIds)
        rippedRouteIds.delete(failedRouteId)
        this.rebuildCommittedStateForCycleEscape(rippedRouteIds)
        this.state.ripCount++
        this.state.currentRouteId = undefined
        this.state.currentRouteNetId = undefined
        this.state.unroutedRoutes = orderRoutesAfterSelectiveRerip({
          failedRouteId,
          pendingRouteIds: this.state.unroutedRoutes,
          rippedRouteIds,
        })
        this.state.candidateQueue.clear()
        this.resetCandidateBestCosts()
        this.state.goalPortId = -1
        this.selectiveReripCycleEscapeCount++
        this.stats = {
          ...this.stats,
          selectiveReripCycleEscapeCount: this.selectiveReripCycleEscapeCount,
          selectiveReripCycleRouteCount: this.cycleRouteIds.size,
          lastCycleEscapeFailedRouteId: failedRouteId,
          lastCycleEscapeRippedRouteIds: [...rippedRouteIds],
        }
        return
      }
    }

    super.onOutOfCandidates()
  }

  private rebuildCommittedStateForCycleEscape(
    rippedRouteIds: ReadonlySet<number>,
  ): void {
    this.state.regionSegments = this.state.regionSegments.map((segments) =>
      segments.filter(([routeId]) => !rippedRouteIds.has(routeId)),
    )
    this.state.portAssignment.fill(-1)
    this.state.regionIntersectionCaches = Array.from(
      { length: this.topology.regionCount },
      () => createEmptyRegionIntersectionCache(),
    )

    for (
      let regionId = 0;
      regionId < this.state.regionSegments.length;
      regionId++
    ) {
      for (const [routeId, fromPortId, toPortId] of this.state.regionSegments[
        regionId
      ]!) {
        const routeNetId = this.problem.routeNet[routeId]!
        this.state.currentRouteNetId = routeNetId
        for (const portId of [fromPortId, toPortId]) {
          const assignedNetId = this.state.portAssignment[portId]!
          if (assignedNetId !== -1 && assignedNetId !== routeNetId) {
            throw new Error(
              `SelectiveReripTinyHyperGraphSolver: cycle escape found cross-net ownership at port ${portId} between net ${assignedNetId} and net ${routeNetId}`,
            )
          }
          this.state.portAssignment[portId] = routeNetId
        }
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
      }
    }
    this.state.currentRouteNetId = undefined
  }

  private seedViaBridgeRoutes() {
    const portIdBySerializedId = new Map<string, number>()
    for (
      let portId = 0;
      portId < (this.topology.portMetadata?.length ?? 0);
      portId++
    ) {
      const serializedPortId =
        this.topology.portMetadata?.[portId]?.serializedPortId
      if (typeof serializedPortId === "string") {
        portIdBySerializedId.set(serializedPortId, portId)
      }
    }

    const regionIdBySerializedId = new Map<string, number>()
    for (
      let regionId = 0;
      regionId < (this.topology.regionMetadata?.length ?? 0);
      regionId++
    ) {
      const serializedRegionId =
        this.topology.regionMetadata?.[regionId]?.serializedRegionId
      if (typeof serializedRegionId === "string") {
        regionIdBySerializedId.set(serializedRegionId, regionId)
      }
    }

    for (let routeId = 0; routeId < this.problem.routeCount; routeId++) {
      const routeMetadata = this.problem.routeMetadata?.[
        routeId
      ] as RouteMetadata
      const viaBridgePortId = portIdBySerializedId.get(
        `${TINY_TERMINAL_VIA_BRIDGE_PORT_PREFIX}${routeMetadata.connectionId}`,
      )
      if (viaBridgePortId === undefined) continue

      const alreadySeeded = this.state.regionSegments.some((segments) =>
        segments.some(([segmentRouteId]) => segmentRouteId === routeId),
      )
      if (alreadySeeded) continue

      const startRegionId = routeMetadata.startRegionId
        ? regionIdBySerializedId.get(routeMetadata.startRegionId)
        : undefined
      const endRegionId = routeMetadata.endRegionId
        ? regionIdBySerializedId.get(routeMetadata.endRegionId)
        : undefined
      if (startRegionId === undefined || endRegionId === undefined) {
        throw new Error(
          `Could not map via bridge regions for "${routeMetadata.connectionId}"`,
        )
      }

      const startPortId = this.problem.routeStartPort[routeId]!
      const endPortId = this.problem.routeEndPort[routeId]!
      const startCandidate: Candidate = {
        portId: startPortId,
        nextRegionId: startRegionId,
        f: 0,
        g: 0,
        h: 0,
      }
      const viaBridgeCandidate: Candidate = {
        prevRegionId: startRegionId,
        portId: viaBridgePortId,
        nextRegionId: endRegionId,
        prevCandidate: startCandidate,
        f: 0,
        g: 0,
        h: 0,
      }

      this.state.unroutedRoutes = this.state.unroutedRoutes.filter(
        (unroutedRouteId) => unroutedRouteId !== routeId,
      )
      this.state.currentRouteId = routeId
      this.state.currentRouteNetId = this.problem.routeNet[routeId]
      this.state.goalPortId = endPortId
      this.onPathFound(viaBridgeCandidate)
    }
  }
}

class TinyHyperGraphSectionPipelineWithTerminalNetIds extends TinyHyperGraphSectionPipelineSolver {
  private configuredSolvers = new WeakSet<BaseSolver>()
  duplicatePortPenaltyCount = 0
  metadataPortPenaltyCount = 0
  crampedPortPenaltyCount = 0
  readonly crampedPortTraversalPenalty: number
  readonly useSelectiveReripRouting: boolean

  constructor(
    inputProblem: TinyHyperGraphSectionPipelineInput,
    useSelectiveReripRouting: boolean,
  ) {
    super(inputProblem)
    this.useSelectiveReripRouting = useSelectiveReripRouting
    this.crampedPortTraversalPenalty = DEFAULT_CRAMPED_PORT_TRAVERSAL_PENALTY
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
        SelectiveReripTinyHyperGraphSolverWithViaBridges
    }
    this.MAX_ITERATIONS = getTinyHyperGraphPipelineMaxIterations(inputProblem)
  }

  override loadHyperGraph(serializedHyperGraph: SerializedHyperGraph) {
    const loaded = super.loadHyperGraph(serializedHyperGraph)
    const metadataPortPenaltyCount = applyMetadataPortPenalties(loaded)
    const { duplicatePortPenaltyCount, crampedPortPenaltyCount } =
      applyPortMetadataPenalties(loaded, this.crampedPortTraversalPenalty)
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
      this.initialVisualizationSolver = new SelectiveReripTinyHyperGraphSolver(
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
  private availableZByOriginalRegionId: Map<CapacityMeshNodeId, number[]>

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
    const serializedGraph = buildSerializedTinyGraph({ ...params, connections })
    const shouldRunDuplicateCongestedPortPrepass =
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
    this.availableZByOriginalRegionId = new Map(
      graphForTiny.regions
        .filter((region) => this.originalRegionIds.has(region.regionId))
        .map((region) => [region.regionId, [...region.d.availableZ]]),
    )
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
      cramped: Boolean(portMetadata?.cramped),
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
      const metadata = asTinyRegionMetadata(regionMetadata[regionId])
      const capacityMeshNodeId = regionMetadata[regionId]?.capacityMeshNodeId
      const isTargetAttachmentBridge =
        metadata._tinyTargetAttachmentBridge === true
      if (
        !capacityMeshNodeId ||
        (!this.originalRegionIds.has(capacityMeshNodeId) &&
          !isTargetAttachmentBridge)
      ) {
        continue
      }

      const originalRegion = this.originalRegionById.get(capacityMeshNodeId)
      const center = originalRegion?.d.center ?? metadata.center
      const width = originalRegion?.d.width ?? metadata.width
      const height = originalRegion?.d.height ?? metadata.height
      if (!center || width === undefined || height === undefined) continue

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
        capacityMeshNodeId,
        center,
        width,
        height,
        portPoints,
        portPointsInPairs,
        availableZ:
          this.availableZByOriginalRegionId.get(capacityMeshNodeId) ??
          metadata.availableZ ??
          [],
        _containsTarget: originalRegion?.d._containsTarget,
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
