import { readFileSync } from "node:fs"
import type { GraphicsObject, Line, Point, Rect } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
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
import type { HgPortPointPathingSolverParams } from "../hgportpointpathingsolver/types"

type RouteMetadata = {
  connectionId: string
  mutuallyConnectedNetworkId?: string
  simpleRouteConnection?: HgPortPointPathingSolverParams["connections"][number]["simpleRouteConnection"]
}

type RustGraphRegion = HgPortPointPathingSolverParams["graph"]["regions"][number]

type RustRegionInput = {
  id: string
  capacity_mesh_node_id: string
  center_x: number
  center_y: number
  available_z: number[]
  contains_obstacle: boolean
  contains_target: boolean
  target_connection_name?: string
  reserved_net_ids: string[]
}

type RustPortInput = {
  id: string
  region1_id: string
  region2_id: string
  x: number
  y: number
  z: number
  penalty: number
}

type RustConnectionInput = {
  id: string
  net_id: string
  start_region_id: string
  end_region_id: string
  start_terminal_port_id: string
  end_terminal_port_id: string
  start_x: number
  start_y: number
  start_z: number
  end_x: number
  end_y: number
  end_z: number
}

type RustPathingInput = {
  regions: RustRegionInput[]
  ports: RustPortInput[]
  connections: RustConnectionInput[]
}

type RustSegmentOutput = {
  connection_id: string
  from_port_id: string
  to_port_id: string
}

type RustRegionOutput = {
  region_id: string
  capacity_mesh_node_id: string
  segments: RustSegmentOutput[]
}

type RustPathingSuccess = {
  ok: "true"
  regions: RustRegionOutput[]
  stats: {
    routed_connection_count: number
    region_assignment_count: number
    routing_attempt_count: number
    selected_routing_order: string
  }
}

type RustPathingError = {
  ok: "false"
  error: string
}

type RustPathingResult = RustPathingSuccess | RustPathingError

type RustPortMetadata = {
  portId: string
  x: number
  y: number
  z: number
  prevPortPointId?: string
  nextPortPointId?: string
  distToCentermostPortOnZ?: number
  cramped?: boolean
  duplicatedFromPortId?: string
  connectionNodeIds?: [CapacityMeshNodeId, CapacityMeshNodeId]
}

type RustWasmExports = {
  memory: WebAssembly.Memory
  wasm_alloc: (len: number) => number
  wasm_dealloc: (ptr: number, len: number) => void
  solve_port_point_pathing_json: (ptr: number, len: number) => bigint
}

type SolverOutput = {
  nodesWithPortPoints: NodeWithPortPoints[]
  inputNodeWithPortPoints: InputNodeWithPortPoints[]
}

type RustDuplicateCongestedPortReport = {
  portUseCounts: Record<string, number>
  duplicatePortIdsBySource: Record<string, string[]>
  duplicateSourcePortCount: number
  duplicatedPortCount: number
}

type RustPathingInputStats = {
  inputRegionCount: number
  inputPortCount: number
  inputConnectionCount: number
  inputTerminalPortCount: number
  inputObstacleRegionCount: number
  inputTargetRegionCount: number
  inputObstacleTargetRegionCount: number
}

type RustPathingOutputStats = {
  outputRegionCount: number
  outputSegmentCount: number
  outputTerminalSegmentCount: number
  outputDuplicatePortSegmentCount: number
  outputObstacleRegionSegmentCount: number
  outputTargetRegionSegmentCount: number
  outputForeignTargetRegionSegmentCount: number
  outputAssignedObstacleRegionIds: string[]
  outputAssignedTargetRegionIds: string[]
  outputForeignTargetRegionIds: string[]
}

const wasmPath = new URL(
  "./port_point_pathing_wasm.wasm",
  import.meta.url,
)

const DUPLICATE_PORT_PROXIMITY = 0.05
const DUPLICATE_PORT_TRAVERSAL_PENALTY = 150
const ENABLE_DUPLICATE_CONGESTED_PORT_PREPASS = false
const MAX_DEBUG_SAMPLE_ITEMS = 25

let wasmExports: RustWasmExports | null = null

const assertDefined = <T>(value: T | null | undefined, message: string): T => {
  if (value === null || value === undefined) {
    throw new Error(message)
  }

  return value
}

const getWasmExports = (): RustWasmExports => {
  if (wasmExports) {
    return wasmExports
  }

  const bytes = new Uint8Array(readFileSync(wasmPath))
  const module = new WebAssembly.Module(bytes)
  const instance = new WebAssembly.Instance(module, {})
  wasmExports = instance.exports as RustWasmExports
  return wasmExports
}

const callRustPathingWasm = (input: RustPathingInput): RustPathingResult => {
  const exports = getWasmExports()
  const inputBytes = new TextEncoder().encode(JSON.stringify(input))
  const inputPtr = exports.wasm_alloc(inputBytes.length)
  new Uint8Array(exports.memory.buffer, inputPtr, inputBytes.length).set(
    inputBytes,
  )

  let outputPtr = 0
  let outputLen = 0
  try {
    const packedResult = exports.solve_port_point_pathing_json(
      inputPtr,
      inputBytes.length,
    )
    outputPtr = Number(packedResult & 0xffff_ffffn)
    outputLen = Number(packedResult >> 32n)
    const outputBytes = new Uint8Array(
      exports.memory.buffer,
      outputPtr,
      outputLen,
    )
    return JSON.parse(new TextDecoder().decode(outputBytes))
  } finally {
    exports.wasm_dealloc(inputPtr, inputBytes.length)
    if (outputPtr !== 0 && outputLen !== 0) {
      exports.wasm_dealloc(outputPtr, outputLen)
    }
  }
}

const getRouteConnectionName = (routeMetadata: RouteMetadata): string =>
  routeMetadata.simpleRouteConnection?.name ?? routeMetadata.connectionId

const getRouteRootConnectionName = (
  routeMetadata: RouteMetadata,
): string | undefined =>
  routeMetadata.simpleRouteConnection?.rootConnectionName ??
  routeMetadata.mutuallyConnectedNetworkId

const getRoutePoint = (
  routeMetadata: RouteMetadata,
  endpointIndex: 0 | 1,
): SimpleRouteConnection["pointsToConnect"][number] | null => {
  const point = routeMetadata.simpleRouteConnection?.pointsToConnect[
    endpointIndex
  ]
  if (!point) {
    return null
  }

  return point
}

const getSharedConnectionZ = (params: {
  routeMetadata: RouteMetadata
  endpointIndex: 0 | 1
  regionAvailableZ: number[]
  layerCount: number
}): number => {
  const point = assertDefined(
    getRoutePoint(params.routeMetadata, params.endpointIndex),
    `RustWasmPortPointPathingSolver: route ${params.routeMetadata.connectionId} endpoint ${params.endpointIndex} is missing a route point`,
  )

  const pointZLayers = getConnectionPointLayers(point).map((layerName) =>
    mapLayerNameToZ(layerName, params.layerCount),
  )
  const sharedZ = params.regionAvailableZ.find((z) => pointZLayers.includes(z))
  return assertDefined(
    sharedZ,
    `RustWasmPortPointPathingSolver: route ${params.routeMetadata.connectionId} endpoint ${params.endpointIndex} layers ${pointZLayers.join(",")} do not intersect region layers ${params.regionAvailableZ.join(",")}`,
  )
}

const createRouteMetadata = (
  connection: HgPortPointPathingSolverParams["connections"][number],
): RouteMetadata => ({
  connectionId: connection.connectionId,
  mutuallyConnectedNetworkId:
    connection.mutuallyConnectedNetworkId ?? connection.connectionId,
  simpleRouteConnection: connection.simpleRouteConnection,
})

const createTerminalPortMetadata = (params: {
  portId: string
  routeMetadata: RouteMetadata
  endpointIndex: 0 | 1
  region: HgPortPointPathingSolverParams["graph"]["regions"][number]
  z: number
}): RustPortMetadata => {
  const point = assertDefined(
    getRoutePoint(params.routeMetadata, params.endpointIndex),
    `RustWasmPortPointPathingSolver: route ${params.routeMetadata.connectionId} endpoint ${params.endpointIndex} is missing a route point`,
  )

  return {
    portId: params.portId,
    x: point.x,
    y: point.y,
    z: params.z,
    distToCentermostPortOnZ: 0,
    connectionNodeIds: [params.region.regionId, params.region.regionId],
  }
}

const getPortMetadata = (
  port: HgPortPointPathingSolverParams["graph"]["ports"][number],
): RustPortMetadata => {
  const metadata = port.d as typeof port.d & Partial<RustPortMetadata>
  return {
    portId: port.d.portId,
    x: port.d.x,
    y: port.d.y,
    z: port.d.z,
    prevPortPointId: metadata.prevPortPointId,
    nextPortPointId: metadata.nextPortPointId,
    distToCentermostPortOnZ: port.d.distToCentermostPortOnZ,
    cramped: port.d.cramped,
    duplicatedFromPortId:
      typeof metadata.duplicatedFromPortId === "string"
        ? metadata.duplicatedFromPortId
        : undefined,
    connectionNodeIds: [port.region1.regionId, port.region2.regionId],
  }
}

const buildRustPathingInput = (
  params: HgPortPointPathingSolverParams,
  portMetadataById: Map<string, RustPortMetadata>,
): RustPathingInput => {
  for (const port of params.graph.ports) {
    portMetadataById.set(port.d.portId, getPortMetadata(port))
  }

  const connections: RustConnectionInput[] = []
  const reservedNetIdsByRegionId = new Map<string, Set<string>>()
  const addReservedNetId = (regionId: string, netId: string): void => {
    const reservedNetIds = reservedNetIdsByRegionId.get(regionId) ?? new Set()
    reservedNetIds.add(netId)
    reservedNetIdsByRegionId.set(regionId, reservedNetIds)
  }

  for (const connection of params.connections) {
    const routeMetadata = createRouteMetadata(connection)
    const netId =
      connection.mutuallyConnectedNetworkId ?? connection.connectionId
    addReservedNetId(connection.startRegion.regionId, netId)
    addReservedNetId(connection.endRegion.regionId, netId)
    const startZ = getSharedConnectionZ({
      routeMetadata,
      endpointIndex: 0,
      regionAvailableZ: connection.startRegion.d.availableZ,
      layerCount: params.layerCount,
    })
    const endZ = getSharedConnectionZ({
      routeMetadata,
      endpointIndex: 1,
      regionAvailableZ: connection.endRegion.d.availableZ,
      layerCount: params.layerCount,
    })
    const startTerminalPortId = `rust-terminal:start-port:${connection.connectionId}`
    const endTerminalPortId = `rust-terminal:end-port:${connection.connectionId}`
    portMetadataById.set(
      startTerminalPortId,
      createTerminalPortMetadata({
        portId: startTerminalPortId,
        routeMetadata,
        endpointIndex: 0,
        region: connection.startRegion,
        z: startZ,
      }),
    )
    portMetadataById.set(
      endTerminalPortId,
      createTerminalPortMetadata({
        portId: endTerminalPortId,
        routeMetadata,
        endpointIndex: 1,
        region: connection.endRegion,
        z: endZ,
      }),
    )

    connections.push({
      id: connection.connectionId,
      net_id: netId,
      start_region_id: connection.startRegion.regionId,
      end_region_id: connection.endRegion.regionId,
      start_terminal_port_id: startTerminalPortId,
      end_terminal_port_id: endTerminalPortId,
      start_x: portMetadataById.get(startTerminalPortId)!.x,
      start_y: portMetadataById.get(startTerminalPortId)!.y,
      start_z: startZ,
      end_x: portMetadataById.get(endTerminalPortId)!.x,
      end_y: portMetadataById.get(endTerminalPortId)!.y,
      end_z: endZ,
    })
  }

  return {
    regions: params.graph.regions.map((region) => ({
      id: region.regionId,
      capacity_mesh_node_id: region.d.capacityMeshNodeId,
      center_x: region.d.center.x,
      center_y: region.d.center.y,
      available_z: region.d.availableZ,
      contains_obstacle: region.d._containsObstacle === true,
      contains_target: region.d._containsTarget === true,
      target_connection_name: region.d._targetConnectionName,
      reserved_net_ids: [
        ...new Set([
          ...(reservedNetIdsByRegionId.get(region.regionId) ?? []),
          ...(region.d._targetConnectionName
            ? [region.d._targetConnectionName]
            : []),
        ]),
      ].sort(),
    })),
    ports: params.graph.ports.map((port) => ({
      id: port.d.portId,
      region1_id: port.region1.regionId,
      region2_id: port.region2.regionId,
      x: port.d.x,
      y: port.d.y,
      z: port.d.z,
      penalty:
        Number(port.d.tinyHypergraphPortPenalty ?? 0) +
        (port.d.cramped ? 150 : 0),
    })),
    connections,
  }
}

const buildInputNodesWithPortPoints = (
  params: HgPortPointPathingSolverParams,
  rustInput: RustPathingInput,
  portMetadataById: Map<string, RustPortMetadata>,
): InputNodeWithPortPoints[] => {
  const terminalPortPointsByRegionId = buildTerminalPortPointsByRegionId({
    params,
    rustInput,
    portMetadataById,
  })
  const regionById = new Map<CapacityMeshNodeId, RustGraphRegion>(
    params.graph.regions.map((region) => [region.regionId, region]),
  )
  const portsByRegionId = new Map<string, InputPortPoint[]>()
  for (const port of rustInput.ports) {
    const metadata = assertDefined(
      portMetadataById.get(port.id),
      `RustWasmPortPointPathingSolver: port metadata for ${port.id} missing from duplicate-expanded input`,
    )
    const portPoint = buildInputPortPoint({
      params,
      metadata,
      regionById,
    })
    for (const regionId of [port.region1_id, port.region2_id]) {
      const portPoints = portsByRegionId.get(regionId) ?? []
      portPoints.push(portPoint)
      portsByRegionId.set(regionId, portPoints)
    }
  }

  return params.graph.regions.map((region) => ({
    capacityMeshNodeId: region.d.capacityMeshNodeId,
    center: region.d.center,
    width: region.d.width,
    height: region.d.height,
    availableZ: region.d.availableZ,
    _containsObstacle: region.d._containsObstacle,
    _containsTarget: region.d._containsTarget,
    _offBoardConnectionId: region.d._offBoardConnectionId,
    _offBoardConnectedCapacityMeshNodeIds:
      region.d._offBoardConnectedCapacityMeshNodeIds,
    _qfpRegionType: (region.d as typeof region.d & { _qfpRegionType?: any })
      ._qfpRegionType,
    _isNarrowQfpPadGap: (
      region.d as typeof region.d & { _isNarrowQfpPadGap?: boolean }
    )._isNarrowQfpPadGap,
    portPoints: [
      ...(portsByRegionId.get(region.regionId) ?? []),
      ...(terminalPortPointsByRegionId.get(region.regionId) ?? []),
    ],
  }))
}

const buildInputPortPoint = (params: {
  params: HgPortPointPathingSolverParams
  metadata: RustPortMetadata
  regionById: Map<CapacityMeshNodeId, RustGraphRegion>
}): InputPortPoint => {
  const connectionNodeIds = assertDefined(
    params.metadata.connectionNodeIds,
    `RustWasmPortPointPathingSolver: port ${params.metadata.portId} has no connection nodes`,
  )

  return {
    portPointId: params.metadata.portId,
    x: params.metadata.x,
    y: params.metadata.y,
    z: params.metadata.z,
    prevPortPointId: params.metadata.prevPortPointId,
    nextPortPointId: params.metadata.nextPortPointId,
    connectionNodeIds,
    distToCentermostPortOnZ: params.metadata.distToCentermostPortOnZ ?? 0,
    cramped: Boolean(params.metadata.cramped),
    connectsToOffBoardNode: isOffBoardPort(params.regionById, params.metadata),
  } satisfies InputPortPoint
}

const buildTerminalPortPointsByRegionId = (params: {
  params: HgPortPointPathingSolverParams
  rustInput: RustPathingInput
  portMetadataById: Map<string, RustPortMetadata>
}): Map<string, InputPortPoint[]> => {
  const portPointsByRegionId = new Map<string, InputPortPoint[]>()
  const regionById = new Map<CapacityMeshNodeId, RustGraphRegion>(
    params.params.graph.regions.map((region) => [region.regionId, region]),
  )
  for (const connection of params.rustInput.connections) {
    for (const terminal of [
      {
        regionId: connection.start_region_id,
        portId: connection.start_terminal_port_id,
      },
      {
        regionId: connection.end_region_id,
        portId: connection.end_terminal_port_id,
      },
    ]) {
      const metadata = assertDefined(
        params.portMetadataById.get(terminal.portId),
        `RustWasmPortPointPathingSolver: terminal metadata for ${terminal.portId} missing from input view`,
      )
      const portPoints = portPointsByRegionId.get(terminal.regionId) ?? []
      portPoints.push(
        buildInputPortPoint({
          params: params.params,
          metadata,
          regionById,
        }),
      )
      portPointsByRegionId.set(terminal.regionId, portPoints)
    }
  }

  return portPointsByRegionId
}

const isOffBoardPort = (
  regionById: Map<CapacityMeshNodeId, RustGraphRegion>,
  metadata: RustPortMetadata,
): boolean => {
  if (!metadata.connectionNodeIds) {
    return false
  }

  const firstRegion = regionById.get(metadata.connectionNodeIds[0])
  const secondRegion = regionById.get(metadata.connectionNodeIds[1])
  return Boolean(
    firstRegion?.d._offBoardConnectionId ?? secondRegion?.d._offBoardConnectionId,
  )
}

const countUsedNonTerminalPorts = (
  result: RustPathingSuccess,
): Map<string, number> => {
  const portsUsedByConnection = new Map<string, Set<string>>()
  for (const region of result.regions) {
    for (const segment of region.segments) {
      const usedPorts =
        portsUsedByConnection.get(segment.connection_id) ?? new Set<string>()
      for (const portId of [segment.from_port_id, segment.to_port_id]) {
        if (!portId.startsWith("rust-terminal:")) {
          usedPorts.add(portId)
        }
      }
      portsUsedByConnection.set(segment.connection_id, usedPorts)
    }
  }

  const portUseCounts = new Map<string, number>()
  for (const usedPorts of portsUsedByConnection.values()) {
    for (const portId of usedPorts) {
      portUseCounts.set(portId, (portUseCounts.get(portId) ?? 0) + 1)
    }
  }
  return portUseCounts
}

const countIndependentlySolvedRoutePorts = (
  input: RustPathingInput,
): Map<string, number> => {
  const portUseCounts = new Map<string, number>()
  for (const connection of input.connections) {
    const routeResult = callRustPathingWasm({
      ...input,
      connections: [connection],
    })
    if (routeResult.ok === "false") {
      throw new Error(
        `RustWasmPortPointPathingSolver: duplicate prepass failed for connection ${connection.id}: ${routeResult.error}`,
      )
    }

    for (const portId of countUsedNonTerminalPorts(routeResult).keys()) {
      portUseCounts.set(portId, (portUseCounts.get(portId) ?? 0) + 1)
    }
  }
  return portUseCounts
}

const duplicateCongestedPorts = (
  input: RustPathingInput,
  portUseCounts: Map<string, number>,
  portMetadataById: Map<string, RustPortMetadata>,
): { input: RustPathingInput; report: RustDuplicateCongestedPortReport } => {
  const regionById = new Map(input.regions.map((region) => [region.id, region]))
  const sourcePortById = new Map(input.ports.map((port) => [port.id, port]))
  const usedPortIds = new Set(input.ports.map((port) => port.id))
  const ports = input.ports.map((port) => ({ ...port }))
  const duplicatePortIdsBySource: Record<string, string[]> = {}
  let duplicateSourcePortCount = 0
  let duplicatedPortCount = 0

  for (const [sourcePortId, useCount] of [...portUseCounts.entries()].sort(
    ([leftPortId], [rightPortId]) => leftPortId.localeCompare(rightPortId),
  )) {
    if (useCount <= 1) continue
    const sourcePort = sourcePortById.get(sourcePortId)
    const sourceMetadata = portMetadataById.get(sourcePortId)
    if (!sourcePort || !sourceMetadata) continue

    duplicateSourcePortCount++
    const duplicateCount = useCount - 1
    const direction = getDuplicateDirection(sourcePort, input.ports, regionById)
    const duplicatePortIds: string[] = []
    for (let duplicateIndex = 1; duplicateIndex <= duplicateCount; duplicateIndex++) {
      const duplicatePortId = createDuplicatePortId(
        sourcePortId,
        duplicateIndex,
        usedPortIds,
      )
      const offset =
        (DUPLICATE_PORT_PROXIMITY * duplicateIndex) / (duplicateCount + 1)
      const duplicateMetadata: RustPortMetadata = {
        ...sourceMetadata,
        portId: duplicatePortId,
        x: sourceMetadata.x + direction.x * offset,
        y: sourceMetadata.y + direction.y * offset,
        duplicatedFromPortId: sourcePortId,
      }
      portMetadataById.set(duplicatePortId, duplicateMetadata)
      ports.push({
        ...sourcePort,
        id: duplicatePortId,
        x: duplicateMetadata.x,
        y: duplicateMetadata.y,
        penalty: sourcePort.penalty + DUPLICATE_PORT_TRAVERSAL_PENALTY,
      })
      duplicatePortIds.push(duplicatePortId)
      duplicatedPortCount++
    }
    duplicatePortIdsBySource[sourcePortId] = duplicatePortIds
  }

  return {
    input: { ...input, ports },
    report: {
      portUseCounts: Object.fromEntries([...portUseCounts.entries()].sort()),
      duplicatePortIdsBySource,
      duplicateSourcePortCount,
      duplicatedPortCount,
    },
  }
}

const summarizeRustPathingInput = (
  input: RustPathingInput,
): RustPathingInputStats => ({
  inputRegionCount: input.regions.length,
  inputPortCount: input.ports.length,
  inputConnectionCount: input.connections.length,
  inputTerminalPortCount: input.connections.length * 2,
  inputObstacleRegionCount: input.regions.filter(
    (region) => region.contains_obstacle,
  ).length,
  inputTargetRegionCount: input.regions.filter((region) => region.contains_target)
    .length,
  inputObstacleTargetRegionCount: input.regions.filter(
    (region) => region.contains_obstacle && region.contains_target,
  ).length,
})

const summarizeRustPathingOutput = (params: {
  input: RustPathingInput
  result: RustPathingSuccess
  portMetadataById: Map<string, RustPortMetadata>
}): RustPathingOutputStats => {
  const regionById = new Map(
    params.input.regions.map((region) => [region.id, region]),
  )
  const netIdByConnectionId = new Map(
    params.input.connections.map((connection) => [
      connection.id,
      connection.net_id,
    ]),
  )
  const assignedObstacleRegionIds = new Set<string>()
  const assignedTargetRegionIds = new Set<string>()
  const foreignTargetRegionIds = new Set<string>()
  let outputSegmentCount = 0
  let outputTerminalSegmentCount = 0
  let outputDuplicatePortSegmentCount = 0
  let outputObstacleRegionSegmentCount = 0
  let outputTargetRegionSegmentCount = 0
  let outputForeignTargetRegionSegmentCount = 0

  for (const regionOutput of params.result.regions) {
    const region = assertDefined(
      regionById.get(regionOutput.region_id),
      `RustWasmPortPointPathingSolver: output region ${regionOutput.region_id} missing from Rust input`,
    )
    for (const segment of regionOutput.segments) {
      outputSegmentCount++
      if (
        segment.from_port_id.startsWith("rust-terminal:") ||
        segment.to_port_id.startsWith("rust-terminal:")
      ) {
        outputTerminalSegmentCount++
      }
      if (
        params.portMetadataById.get(segment.from_port_id)?.duplicatedFromPortId ||
        params.portMetadataById.get(segment.to_port_id)?.duplicatedFromPortId
      ) {
        outputDuplicatePortSegmentCount++
      }
      if (region.contains_obstacle) {
        outputObstacleRegionSegmentCount++
        assignedObstacleRegionIds.add(region.id)
      }
      if (region.contains_target) {
        outputTargetRegionSegmentCount++
        assignedTargetRegionIds.add(region.id)
      }
      if (
        isForeignTargetRegionAssignment({
          region,
          connectionId: segment.connection_id,
          netId: assertDefined(
            netIdByConnectionId.get(segment.connection_id),
            `RustWasmPortPointPathingSolver: output segment connection ${segment.connection_id} missing from Rust input`,
          ),
        })
      ) {
        outputForeignTargetRegionSegmentCount++
        foreignTargetRegionIds.add(region.id)
      }
    }
  }

  return {
    outputRegionCount: params.result.regions.length,
    outputSegmentCount,
    outputTerminalSegmentCount,
    outputDuplicatePortSegmentCount,
    outputObstacleRegionSegmentCount,
    outputTargetRegionSegmentCount,
    outputForeignTargetRegionSegmentCount,
    outputAssignedObstacleRegionIds: sortedSample(assignedObstacleRegionIds),
    outputAssignedTargetRegionIds: sortedSample(assignedTargetRegionIds),
    outputForeignTargetRegionIds: sortedSample(foreignTargetRegionIds),
  }
}

const isForeignTargetRegionAssignment = (params: {
  region: RustRegionInput
  connectionId: string
  netId: string
}): boolean => {
  if (!params.region.contains_target || !params.region.target_connection_name) {
    return false
  }

  return (
    params.region.target_connection_name !== params.connectionId &&
    params.region.target_connection_name !== params.netId
  )
}

const sortedSample = (values: Set<string>): string[] =>
  [...values].sort().slice(0, MAX_DEBUG_SAMPLE_ITEMS)

const getDuplicateDirection = (
  sourcePort: RustPortInput,
  ports: RustPortInput[],
  regionById: Map<string, RustRegionInput>,
): { x: number; y: number } => {
  let nearestPort: RustPortInput | undefined
  let nearestDistance = Number.POSITIVE_INFINITY
  const sourceBoundaryKey = getBoundaryKey(sourcePort)

  for (const port of ports) {
    if (port.id === sourcePort.id || getBoundaryKey(port) !== sourceBoundaryKey) {
      continue
    }
    const candidateDistance = Math.hypot(sourcePort.x - port.x, sourcePort.y - port.y)
    if (candidateDistance <= 1e-9 || candidateDistance >= nearestDistance) {
      continue
    }
    nearestPort = port
    nearestDistance = candidateDistance
  }

  if (nearestPort) {
    const awayFromNearest = normalizeVector({
      x: sourcePort.x - nearestPort.x,
      y: sourcePort.y - nearestPort.y,
    })
    if (awayFromNearest) return awayFromNearest
  }

  const region1 = regionById.get(sourcePort.region1_id)
  const region2 = regionById.get(sourcePort.region2_id)
  return (
    normalizeVector({
      x: -((region2?.center_y ?? 0) - (region1?.center_y ?? 0)),
      y: (region2?.center_x ?? 0) - (region1?.center_x ?? 0),
    }) ?? { x: 1, y: 0 }
  )
}

const getBoundaryKey = (port: RustPortInput): string =>
  [port.region1_id, port.region2_id].sort().join("\u0000")

const normalizeVector = (
  vector: { x: number; y: number },
): { x: number; y: number } | undefined => {
  const length = Math.hypot(vector.x, vector.y)
  if (length <= 1e-9) {
    return undefined
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  }
}

const createDuplicatePortId = (
  sourcePortId: string,
  duplicateIndex: number,
  usedPortIds: Set<string>,
): string => {
  const basePortId = `${sourcePortId}::dup${duplicateIndex}`
  if (!usedPortIds.has(basePortId)) {
    usedPortIds.add(basePortId)
    return basePortId
  }

  for (let collisionIndex = 2; ; collisionIndex++) {
    const portId = `${basePortId}-${collisionIndex}`
    if (!usedPortIds.has(portId)) {
      usedPortIds.add(portId)
      return portId
    }
  }
}

export class RustWasmPortPointPathingSolver extends BaseSolver {
  private rustInput: RustPathingInput
  private readonly routeMetadataByConnectionId: Map<string, RouteMetadata>
  private readonly portMetadataById = new Map<string, RustPortMetadata>()
  private inputNodeWithPortPoints: InputNodeWithPortPoints[]
  private readonly originalRegionById: Map<
    CapacityMeshNodeId,
    HgPortPointPathingSolverParams["graph"]["regions"][number]
  >
  private output: SolverOutput | null = null

  constructor(private readonly params: HgPortPointPathingSolverParams) {
    super()
    this.rustInput = buildRustPathingInput(params, this.portMetadataById)
    this.routeMetadataByConnectionId = new Map(
      params.connections.map((connection) => [
        connection.connectionId,
        createRouteMetadata(connection),
      ]),
    )
    this.inputNodeWithPortPoints = buildInputNodesWithPortPoints(
      params,
      this.rustInput,
      this.portMetadataById,
    )
    this.originalRegionById = new Map(
      params.graph.regions.map((region) => [region.regionId, region]),
    )
  }

  override getSolverName(): string {
    return "RustWasmPortPointPathingSolver"
  }

  override _step(): void {
    const baseInputStats = summarizeRustPathingInput(this.rustInput)
    const duplicatePortResult = duplicateCongestedPorts(
      this.rustInput,
      ENABLE_DUPLICATE_CONGESTED_PORT_PREPASS
        ? countIndependentlySolvedRoutePorts(this.rustInput)
        : new Map(),
      this.portMetadataById,
    )
    this.rustInput = duplicatePortResult.input
    this.inputNodeWithPortPoints = buildInputNodesWithPortPoints(
      this.params,
      this.rustInput,
      this.portMetadataById,
    )

    const result = callRustPathingWasm(this.rustInput)
    if (result.ok === "false") {
      throw new Error(result.error)
    }

    const expandedInputStats = summarizeRustPathingInput(this.rustInput)
    const outputStats = summarizeRustPathingOutput({
      input: this.rustInput,
      result,
      portMetadataById: this.portMetadataById,
    })
    this.output = this.buildOutput(result)
    this.stats = {
      rustWasm: true,
      routedConnectionCount: result.stats.routed_connection_count,
      regionAssignmentCount: result.stats.region_assignment_count,
      routingAttemptCount: result.stats.routing_attempt_count,
      selectedRoutingOrder: result.stats.selected_routing_order,
      ...baseInputStats,
      inputPortCountAfterDuplicateExpansion: expandedInputStats.inputPortCount,
      duplicateCongestedPortSourceCount:
        duplicatePortResult.report.duplicateSourcePortCount,
      duplicateCongestedPortCount:
        duplicatePortResult.report.duplicatedPortCount,
      duplicateCongestedPortPenalty:
        duplicatePortResult.report.duplicatedPortCount > 0
          ? DUPLICATE_PORT_TRAVERSAL_PENALTY
          : 0,
      duplicateCongestedPortPortUseCounts:
        duplicatePortResult.report.portUseCounts,
      duplicateCongestedPortIdsBySource:
        duplicatePortResult.report.duplicatePortIdsBySource,
      ...outputStats,
    }
    this.solved = true
  }

  override getConstructorParams(): [HgPortPointPathingSolverParams] {
    return [this.params]
  }

  getOutput(): SolverOutput {
    if (!this.output) {
      throw new Error(
        "RustWasmPortPointPathingSolver: getOutput() called before solved",
      )
    }

    return this.output
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

  override preview(): GraphicsObject {
    return this.visualize()
  }

  override visualize(): GraphicsObject {
    const rects: Rect[] = this.params.graph.regions.map((region) => ({
      center: region.d.center,
      width: region.d.width,
      height: region.d.height,
      fill: "rgba(60, 120, 220, 0.08)",
      stroke: "rgba(60, 120, 220, 0.35)",
      label: region.d.capacityMeshNodeId,
    }))
    const points: Point[] = [...this.portMetadataById.values()].map((port) => ({
      x: port.x,
      y: port.y,
      label: port.portId,
      color: port.portId.startsWith("rust-terminal:")
        ? "rgba(220, 80, 30, 0.9)"
        : "rgba(40, 40, 40, 0.75)",
    }))
    const lines: Line[] = []

    if (this.output) {
      for (const node of this.output.nodesWithPortPoints) {
        for (const [startPoint, endPoint] of node.portPointsInPairs ?? []) {
          lines.push({
            points: [startPoint, endPoint],
            strokeColor: "rgba(20, 150, 80, 0.8)",
          })
        }
      }
    }

    return { rects, points, lines }
  }

  private buildOutput(result: RustPathingSuccess): SolverOutput {
    const nodesWithPortPoints: NodeWithPortPoints[] = []

    for (const regionOutput of result.regions) {
      const originalRegion = assertDefined(
        this.originalRegionById.get(regionOutput.region_id),
        `RustWasmPortPointPathingSolver: region ${regionOutput.region_id} missing from original graph`,
      )
      const portPointsInPairs = regionOutput.segments.map((segment) =>
        this.createPortPointPair(segment),
      )
      const portPoints = portPointsInPairs.flat()

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

  private createPortPointPair(
    segment: RustSegmentOutput,
  ): [PortPoint, PortPoint] {
    const startPoint = this.createAssignedPortPoint(
      segment.connection_id,
      segment.from_port_id,
    )
    const endPoint = this.createAssignedPortPoint(
      segment.connection_id,
      segment.to_port_id,
    )
    startPoint.nextPortPointId = endPoint.portPointId
    endPoint.prevPortPointId = startPoint.portPointId

    return [startPoint, endPoint]
  }

  private createAssignedPortPoint(
    connectionId: string,
    portId: string,
  ): PortPoint {
    const routeMetadata = assertDefined(
      this.routeMetadataByConnectionId.get(connectionId),
      `RustWasmPortPointPathingSolver: route metadata for ${connectionId} not found`,
    )
    const portMetadata = assertDefined(
      this.portMetadataById.get(portId),
      `RustWasmPortPointPathingSolver: port metadata for ${portId} not found`,
    )

    return {
      portPointId: portMetadata.portId,
      x: portMetadata.x,
      y: portMetadata.y,
      z: portMetadata.z,
      connectionName: getRouteConnectionName(routeMetadata),
      rootConnectionName: getRouteRootConnectionName(routeMetadata),
      prevPortPointId: portMetadata.prevPortPointId,
      nextPortPointId: portMetadata.nextPortPointId,
    }
  }
}
