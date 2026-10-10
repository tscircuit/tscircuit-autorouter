import { areNodePortPointPairsConnectedByRoutes } from "../../solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import { getConnectionPortPointPairs } from "../../utils/getConnectionPortPointPairs"
import { getMaximumPipeline9NodeBounds } from "./pipeline9NetworkedInputProjection"
import {
  PIPELINE9_NETWORKED_REPAIR_POLICY,
  type Pipeline9NetworkedHighDensityRepairInput,
  type Pipeline9NetworkedHighDensityRepairOutput,
} from "./pipeline9NetworkedRepairTypes"
import type {
  Pipeline9NetworkedHighDensityNodeInput,
  Pipeline9NetworkedHighDensityNodeOutput,
  Pipeline9NetworkedInput,
  Pipeline9NetworkedOutput,
  Pipeline9NetworkedSolveBatchCacheMiss,
  Pipeline9NetworkedSolveBatchItem,
  Pipeline9NetworkedSolveRequest,
  Pipeline9NetworkedSolveResponse,
} from "./pipeline9NetworkedTypes"

export const DEFAULT_HD_CACHE2_SERVER_URL = "https://hd-cache2.tscircuit.com"
export const HD_CACHE2_TRANSPORT_TIMEOUT_MS = 310_000
export const HD_CACHE2_MAX_BATCH_ITEMS = 100
export const HD_CACHE2_MAX_BATCH_BODY_BYTES = 1.75 * 1024 * 1024

const MAX_RESPONSE_LINE_CHARACTERS = 16 * 1024 * 1024

export type HdCache2FallbackReason =
  | "http_error"
  | "invalid_json"
  | "invalid_response"
  | "missing_response"
  | "remote_error"
  | "request_serialization_error"
  | "response_too_large"
  | "transport_error"
  | "transport_timeout"
  | "cache_version_mismatch"
  | "version_mismatch"

export type HdCache2SolveResult<
  TOutput extends Pipeline9NetworkedOutput = Pipeline9NetworkedHighDensityNodeOutput,
> =
  | {
      kind: "remote"
      response: Extract<Pipeline9NetworkedSolveResponse<TOutput>, { ok: true }>
    }
  | {
      kind: "local-fallback"
      error: string
      reason: HdCache2FallbackReason
    }

export type HdCache2RepairSolveResult =
  HdCache2SolveResult<Pipeline9NetworkedHighDensityRepairOutput>

export type HdCache2ClientStats = {
  batchRequestsStarted: number
  batchRequestsCompleted: number
  batchItemsStarted: number
  batchBodyBytesStarted: number
  batchMaxBodyBytes: number
  batchCacheMisses: number
  singleRequestsStarted: number
  batchInvalidLines: number
  batchUnknownRequestIds: number
  batchDuplicateRequestIds: number
}

export type HdCache2ClientOptions = {
  cacheVersion?: string
}

type PendingSolve = Pipeline9NetworkedSolveBatchItem<Pipeline9NetworkedInput> & {
  serializedItem: string | null
  promise: Promise<HdCache2SolveResult<Pipeline9NetworkedOutput>>
  resolve: (result: HdCache2SolveResult<Pipeline9NetworkedOutput>) => void
  settled: boolean
  singleSolveStarted: boolean
}

type PreparedBatch = {
  body: string
  bodyBytes: number
  items: PendingSolve[]
}

class HdCache2RequestError extends Error {
  constructor(
    readonly reason: HdCache2FallbackReason,
    message: string,
  ) {
    super(message)
    this.name = "HdCache2RequestError"
  }
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const CIRCUIT_JSON_METADATA_KEYS = new Set([
  "pcb_smtpad_id",
  "pcb_plated_hole_id",
  "pcb_port_id",
  "pcb_via_id",
  "source_component_name",
  "source_port_name",
])

const isValidCircuitJsonMetadata = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([key, metadataValue]) =>
      CIRCUIT_JSON_METADATA_KEYS.has(key) && typeof metadataValue === "string",
  )
}

const nearlyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right))

const REGIONAL_TERMINAL_TOLERANCE_MM = 0.001
const ORDINARY_VIA_POSITION_TOLERANCE_MM = 1e-6
const REGIONAL_VIA_POSITION_TOLERANCE_MM = 0.001
const FORCE_COORDINATE_ROUNDING_TOLERANCE_MM = 0.0005

const forceImprovedCoordinatesMatch = (left: number, right: number): boolean => {
  const numericTolerance =
    1e-9 * Math.max(1, Math.abs(left), Math.abs(right))
  const maximumDifference =
    FORCE_COORDINATE_ROUNDING_TOLERANCE_MM + numericTolerance
  return Math.abs(left - right) <= maximumDifference
}

const forceImprovedPortPointsMatch = (
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
): boolean =>
  left.z === right.z &&
  forceImprovedCoordinatesMatch(left.x, right.x) &&
  forceImprovedCoordinatesMatch(left.y, right.y)

const hasForceImprovedRouteCoverage = (
  routes: HighDensityIntraNodeRoute[],
  node: NodeWithPortPoints,
): boolean => {
  const validationRoutes = [...routes]
  const portPoints = [
    ...node.portPoints,
    ...(node.portPointsInPairs ?? []).flat(),
  ]
  // Preserve the ordinary full-segment graph, including interior same-net
  // joins. Force rounding can move terminals by half a grid step; connect the
  // original terminal to compatible vertices only in this validation graph.
  for (const portPoint of portPoints) {
    for (const route of routes) {
      if (route.connectionName !== portPoint.connectionName) continue
      for (const point of route.route) {
        if (!forceImprovedPortPointsMatch(portPoint, point)) continue
        validationRoutes.push({
          ...route,
          route: [portPoint, point],
          vias: [],
        })
      }
    }
  }
  return areNodePortPointPairsConnectedByRoutes(validationRoutes, node)
}

const hasValidRemoteLayerTransitions = (
  route: HighDensityIntraNodeRoute,
  solutionStage: "ordinary" | "regional-fallback",
  forceImproved = false,
): boolean => {
  const viaPositionTolerance =
    solutionStage === "ordinary" && !forceImproved
      ? ORDINARY_VIA_POSITION_TOLERANCE_MM
      : REGIONAL_VIA_POSITION_TOLERANCE_MM
  const usedViaIndexes = new Set<number>()
  for (let index = 0; index < route.route.length - 1; index++) {
    const start = route.route[index]!
    const end = route.route[index + 1]!
    const changesLayer = start.z !== end.z
    if (start.toNextSegmentType === "through_obstacle") {
      if (!changesLayer) return false
      // The force improver derives a via at every co-located transition,
      // including the copper already provided by a plated-hole obstacle.
      if (forceImproved && Math.hypot(start.x - end.x, start.y - end.y) <= viaPositionTolerance) {
        for (const [viaIndex, via] of route.vias.entries()) {
          if (Math.hypot(via.x - start.x, via.y - start.y) <= viaPositionTolerance) {
            usedViaIndexes.add(viaIndex)
          }
        }
      }
      continue
    }
    if (start.toNextSegmentCircuitJsonMetadata !== undefined) return false
    if (!changesLayer) continue

    const viaIndexesAtStart: number[] = []
    const viaIndexesAtEnd: number[] = []
    for (const [viaIndex, via] of route.vias.entries()) {
      if (
        Math.hypot(via.x - start.x, via.y - start.y) <= viaPositionTolerance
      ) {
        viaIndexesAtStart.push(viaIndex)
      }
      if (Math.hypot(via.x - end.x, via.y - end.y) <= viaPositionTolerance) {
        viaIndexesAtEnd.push(viaIndex)
      }
    }
    const transitionIsColocated =
      Math.hypot(start.x - end.x, start.y - end.y) <=
      ORDINARY_VIA_POSITION_TOLERANCE_MM
    if (transitionIsColocated) {
      if (viaIndexesAtStart.length === 0) return false
      for (const viaIndex of viaIndexesAtStart) usedViaIndexes.add(viaIndex)
      continue
    }
    if (solutionStage === "regional-fallback") return false
    if ((viaIndexesAtStart.length === 0) === (viaIndexesAtEnd.length === 0)) {
      return false
    }
    for (const viaIndex of [...viaIndexesAtStart, ...viaIndexesAtEnd]) {
      usedViaIndexes.add(viaIndex)
    }
  }

  const lastPoint = route.route.at(-1)!
  if (
    lastPoint.toNextSegmentType !== undefined ||
    lastPoint.toNextSegmentCircuitJsonMetadata !== undefined
  ) {
    return false
  }

  return route.vias.every((_, viaIndex) => usedViaIndexes.has(viaIndex))
}

const hasRegionalRouteCoverage = (
  routes: HighDensityIntraNodeRoute[],
  node: NodeWithPortPoints,
): boolean => {
  type RouteEndpoint = { x: number; y: number; z: number }
  type RouteEdge = { start: RouteEndpoint; end: RouteEndpoint }

  const pointsTouch = (left: RouteEndpoint, right: RouteEndpoint): boolean => {
    if (left.z !== right.z) return false
    const deltaX = left.x - right.x
    const deltaY = left.y - right.y
    return Math.hypot(deltaX, deltaY) <= REGIONAL_TERMINAL_TOLERANCE_MM
  }

  const routeEdgesByConnection = new Map<string, RouteEdge[]>()
  for (const route of routes) {
    const hasNonzeroSegment = route.route.some((point, index) => {
      const nextPoint = route.route[index + 1]
      return (
        nextPoint !== undefined &&
        (!nearlyEqual(point.x, nextPoint.x) ||
          !nearlyEqual(point.y, nextPoint.y) ||
          point.z !== nextPoint.z)
      )
    })
    const start = route.route[0]
    const end = route.route.at(-1)
    if (!hasNonzeroSegment || !start || !end) return false
    const connectionPortPoints = node.portPoints.filter(
      (portPoint) => portPoint.connectionName === route.connectionName,
    )
    if (
      !connectionPortPoints.some((portPoint) =>
        pointsTouch(start, portPoint),
      ) ||
      !connectionPortPoints.some((portPoint) => pointsTouch(end, portPoint))
    ) {
      return false
    }
    const edges = routeEdgesByConnection.get(route.connectionName) ?? []
    edges.push({ start, end })
    routeEdgesByConnection.set(route.connectionName, edges)
  }

  const arePairEndpointsConnected = (
    connectionName: string,
    start: RouteEndpoint,
    end: RouteEndpoint,
  ): boolean => {
    if (pointsTouch(start, end)) return true
    const edges = routeEdgesByConnection.get(connectionName) ?? []
    const pendingEdgeIndexes: number[] = []
    const visitedEdgeIndexes = new Set<number>()
    for (const [index, edge] of edges.entries()) {
      if (pointsTouch(start, edge.start) || pointsTouch(start, edge.end)) {
        pendingEdgeIndexes.push(index)
        visitedEdgeIndexes.add(index)
      }
    }

    while (pendingEdgeIndexes.length > 0) {
      const edge = edges[pendingEdgeIndexes.pop()!]!
      if (pointsTouch(end, edge.start) || pointsTouch(end, edge.end))
        return true
      for (const [index, candidate] of edges.entries()) {
        if (visitedEdgeIndexes.has(index)) continue
        const connectsToEdge =
          pointsTouch(edge.start, candidate.start) ||
          pointsTouch(edge.start, candidate.end) ||
          pointsTouch(edge.end, candidate.start) ||
          pointsTouch(edge.end, candidate.end)
        if (!connectsToEdge) continue
        visitedEdgeIndexes.add(index)
        pendingEdgeIndexes.push(index)
      }
    }
    return false
  }

  const explicitPairs = node.portPointsInPairs ?? []
  if (explicitPairs.length > 0) {
    return explicitPairs.every(([start, end]) =>
      arePairEndpointsConnected(start.connectionName, start, end),
    )
  }

  const portPointsByConnection = new Map<
    string,
    NodeWithPortPoints["portPoints"]
  >()
  for (const portPoint of node.portPoints) {
    const connectionPortPoints =
      portPointsByConnection.get(portPoint.connectionName) ?? []
    connectionPortPoints.push(portPoint)
    portPointsByConnection.set(portPoint.connectionName, connectionPortPoints)
  }
  return [...portPointsByConnection].every(([, connectionPortPoints]) =>
    getConnectionPortPointPairs(connectionPortPoints).every(([start, end]) =>
      arePairEndpointsConnected(start.connectionName, start, end),
    ),
  )
}

const isValidRemoteRoutes = (
  value: unknown,
  input: Pipeline9NetworkedHighDensityNodeInput,
  solutionStage: "ordinary" | "regional-fallback",
): value is HighDensityIntraNodeRoute[] => {
  if (!Array.isArray(value)) return false

  const portPointsByConnectionName = new Map<
    string,
    NodeWithPortPoints["portPoints"]
  >()
  for (const portPoint of input.nodeWithPortPoints.portPoints) {
    const portPoints =
      portPointsByConnectionName.get(portPoint.connectionName) ?? []
    portPoints.push(portPoint)
    portPointsByConnectionName.set(portPoint.connectionName, portPoints)
  }
  const ordinaryAllowedZ = new Set(
    input.nodeWithPortPoints.availableZ ??
      input.nodeWithPortPoints.portPoints.map((portPoint) => portPoint.z),
  )
  const maximumRouteBounds = getMaximumPipeline9NodeBounds({
    nodeWithPortPoints: input.nodeWithPortPoints,
    obstacleMargin: input.obstacleMargin,
    traceWidth: input.traceWidth,
    viaDiameter: input.viaDiameter,
  })
  const isPortPointForConnection = (
    point: Record<string, unknown>,
    connectionName: string,
  ): boolean =>
    (portPointsByConnectionName.get(connectionName) ?? []).some(
      (portPoint) =>
        typeof point.x === "number" &&
        (input.forceImprove
          ? forceImprovedCoordinatesMatch(point.x, portPoint.x)
          : nearlyEqual(point.x, portPoint.x)) &&
        typeof point.y === "number" &&
        (input.forceImprove
          ? forceImprovedCoordinatesMatch(point.y, portPoint.y)
          : nearlyEqual(point.y, portPoint.y)) &&
        point.z === portPoint.z,
    )

  for (const routeValue of value) {
    if (!routeValue || typeof routeValue !== "object") return false
    const route = routeValue as Record<string, unknown>
    if (
      typeof route.connectionName !== "string" ||
      route.connectionName.length === 0 ||
      !portPointsByConnectionName.has(route.connectionName) ||
      typeof route.traceThickness !== "number" ||
      !Number.isFinite(route.traceThickness) ||
      route.traceThickness <= 0 ||
      typeof route.viaDiameter !== "number" ||
      !Number.isFinite(route.viaDiameter) ||
      route.viaDiameter <= 0 ||
      !nearlyEqual(route.viaDiameter, input.viaDiameter) ||
      !Array.isArray(route.route) ||
      route.route.length < 2 ||
      !Array.isArray(route.vias)
    ) {
      return false
    }

    for (const optionalString of [
      route.rootConnectionName,
      route.startPcbPortId,
      route.endPcbPortId,
      route.regionId,
    ]) {
      if (optionalString !== undefined && typeof optionalString !== "string") {
        return false
      }
    }
    if (
      input.forceImprove &&
      route.regionId !== input.nodeWithPortPoints.capacityMeshNodeId
    ) {
      return false
    }

    for (const pointValue of route.route) {
      if (!pointValue || typeof pointValue !== "object") return false
      const point = pointValue as Record<string, unknown>
      if (
        typeof point.x !== "number" ||
        !Number.isFinite(point.x) ||
        typeof point.y !== "number" ||
        !Number.isFinite(point.y) ||
        point.x < maximumRouteBounds.minX ||
        point.x > maximumRouteBounds.maxX ||
        point.y < maximumRouteBounds.minY ||
        point.y > maximumRouteBounds.maxY ||
        typeof point.z !== "number" ||
        !Number.isInteger(point.z) ||
        point.z < 0 ||
        point.z >= input.layerCount ||
        (solutionStage === "ordinary" && !ordinaryAllowedZ.has(point.z))
      ) {
        return false
      }
      if (
        point.traceThickness !== undefined &&
        (typeof point.traceThickness !== "number" ||
          !Number.isFinite(point.traceThickness) ||
          point.traceThickness <= 0)
      ) {
        return false
      }
      if (
        point.pcb_port_id !== undefined &&
        typeof point.pcb_port_id !== "string"
      ) {
        return false
      }
      if (
        point.insideJumperPad !== undefined &&
        typeof point.insideJumperPad !== "boolean"
      ) {
        return false
      }
      if (
        point.toNextSegmentType !== undefined &&
        point.toNextSegmentType !== "through_obstacle"
      ) {
        return false
      }
      if (
        point.toNextSegmentCircuitJsonMetadata !== undefined &&
        !isValidCircuitJsonMetadata(point.toNextSegmentCircuitJsonMetadata)
      ) {
        return false
      }
    }

    const routePoints = route.route as Record<string, unknown>[]
    if (
      solutionStage === "ordinary" &&
      (!isPortPointForConnection(routePoints[0]!, route.connectionName) ||
        !isPortPointForConnection(routePoints.at(-1)!, route.connectionName))
    ) {
      return false
    }
    if (input.forceImprove?.preserveTerminalPcbPortIds) {
      for (const [point, pcbPortId] of [
        [routePoints[0]!, route.startPcbPortId],
        [routePoints.at(-1)!, route.endPcbPortId],
      ] as const) {
        const candidates = portPointsByConnectionName.get(route.connectionName)!
        const matchesTerminal = candidates.some((portPoint) =>
          forceImprovedCoordinatesMatch(point.x as number, portPoint.x) &&
          forceImprovedCoordinatesMatch(point.y as number, portPoint.y) &&
          point.z === portPoint.z &&
          portPoint.pcb_port_id === pcbPortId,
        )
        // Regional endpoints can already be rounded before terminal IDs are
        // attached, matching the local pipeline's existing exact-match policy.
        if (!matchesTerminal && (solutionStage === "ordinary" || pcbPortId !== undefined)) {
          return false
        }
      }
    }

    for (const viaValue of route.vias) {
      if (!viaValue || typeof viaValue !== "object") return false
      const via = viaValue as Record<string, unknown>
      if (
        typeof via.x !== "number" ||
        !Number.isFinite(via.x) ||
        typeof via.y !== "number" ||
        !Number.isFinite(via.y) ||
        via.x < maximumRouteBounds.minX ||
        via.x > maximumRouteBounds.maxX ||
        via.y < maximumRouteBounds.minY ||
        via.y > maximumRouteBounds.maxY
      ) {
        return false
      }
    }
    if (
      !hasValidRemoteLayerTransitions(
        route as unknown as HighDensityIntraNodeRoute,
        solutionStage,
        input.forceImprove !== undefined,
      )
    ) {
      return false
    }

    if (route.jumpers !== undefined) {
      if (!Array.isArray(route.jumpers)) return false
      for (const jumperValue of route.jumpers) {
        if (!jumperValue || typeof jumperValue !== "object") return false
        const jumper = jumperValue as Record<string, unknown>
        const start = jumper.start as Record<string, unknown> | undefined
        const end = jumper.end as Record<string, unknown> | undefined
        if (
          jumper.route_type !== "jumper" ||
          (jumper.footprint !== "0603" &&
            jumper.footprint !== "1206" &&
            jumper.footprint !== "1206x4_pair") ||
          !start ||
          typeof start.x !== "number" ||
          !Number.isFinite(start.x) ||
          typeof start.y !== "number" ||
          !Number.isFinite(start.y) ||
          !end ||
          typeof end.x !== "number" ||
          !Number.isFinite(end.x) ||
          typeof end.y !== "number" ||
          !Number.isFinite(end.y) ||
          start.x < maximumRouteBounds.minX ||
          start.x > maximumRouteBounds.maxX ||
          start.y < maximumRouteBounds.minY ||
          start.y > maximumRouteBounds.maxY ||
          end.x < maximumRouteBounds.minX ||
          end.x > maximumRouteBounds.maxX ||
          end.y < maximumRouteBounds.minY ||
          end.y > maximumRouteBounds.maxY
        ) {
          return false
        }
      }
    }
  }
  const routes = value as HighDensityIntraNodeRoute[]
  return solutionStage === "ordinary"
    ? input.forceImprove
      ? hasForceImprovedRouteCoverage(routes, input.nodeWithPortPoints)
      : areNodePortPointPairsConnectedByRoutes(routes, input.nodeWithPortPoints)
    : hasRegionalRouteCoverage(routes, input.nodeWithPortPoints)
}

const isValidRemoteRepairResult = (
  response: Record<string, unknown>,
  input: Pipeline9NetworkedHighDensityRepairInput,
): boolean => {
  if (response.solutionStage !== "repair") return false
  if (response.status === "failed") {
    return typeof response.error === "string" && response.error.length > 0
  }
  if (response.status !== "solved" || !Array.isArray(response.repairedRoutes)) {
    return false
  }
  const stats = response.clearanceStats
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return false
  for (const key of [
    "nodeClearanceInitialConflictCount",
    "nodeClearanceFinalConflictCount",
    "nodeClearanceCandidateCount",
  ]) {
    const count = (stats as Record<string, unknown>)[key]
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
      return false
    }
  }

  const originals = input.sample.nodeHdRoutes
  const node = input.sample.nodeWithPortPoints
  if (
    !Array.isArray(originals) ||
    !node ||
    !node.center ||
    typeof node.center.x !== "number" ||
    !Number.isFinite(node.center.x) ||
    typeof node.center.y !== "number" ||
    !Number.isFinite(node.center.y) ||
    typeof node.width !== "number" ||
    !Number.isFinite(node.width) ||
    node.width <= 0 ||
    typeof node.height !== "number" ||
    !Number.isFinite(node.height) ||
    node.height <= 0 ||
    !Array.isArray(node.portPoints) ||
    !Number.isFinite(input.repairMargin) ||
    input.repairMargin < 0
  ) {
    return false
  }
  if (response.repairedRoutes.length !== originals.length) return false
  const layers = new Set<number>(node.portPoints.map((point) => point.z ?? 0))
  for (const original of originals) {
    if (!original.route || !original.vias || original.route.length < 2) {
      return false
    }
    for (const point of original.route) layers.add(point.z ?? 0)
  }
  const originalPoints = originals.flatMap((route) => [
    ...route.route!,
    ...route.vias!,
  ])
  const margin = input.repairMargin
  const minX = Math.min(node.center.x - node.width / 2, ...originalPoints.map((point) => point.x)) - margin
  const maxX = Math.max(node.center.x + node.width / 2, ...originalPoints.map((point) => point.x)) + margin
  const minY = Math.min(node.center.y - node.height / 2, ...originalPoints.map((point) => point.y)) - margin
  const maxY = Math.max(node.center.y + node.height / 2, ...originalPoints.map((point) => point.y)) + margin

  for (const [index, value] of response.repairedRoutes.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const route = value as Record<string, unknown>
    const original = originals[index]!
    if (
      route.connectionName !== original.connectionName ||
      route.rootConnectionName !== original.rootConnectionName ||
      route.capacityMeshNodeId !== original.capacityMeshNodeId ||
      route.traceThickness !== original.traceThickness ||
      route.viaDiameter !== original.viaDiameter ||
      typeof route.traceThickness !== "number" ||
      !Number.isFinite(route.traceThickness) ||
      route.traceThickness <= 0 ||
      typeof route.viaDiameter !== "number" ||
      !Number.isFinite(route.viaDiameter) ||
      route.viaDiameter <= 0 ||
      JSON.stringify(route.connectedPadSides) !== JSON.stringify(original.connectedPadSides) ||
      !Array.isArray(route.route) ||
      route.route.length < 2 ||
      !Array.isArray(route.vias)
    ) {
      return false
    }
    const points = route.route as Array<Record<string, unknown>>
    for (const point of points) {
      if (!point || typeof point !== "object" || Array.isArray(point)) return false
      const z = point.z === undefined ? 0 : point.z
      if (
        typeof point.x !== "number" ||
        !Number.isFinite(point.x) ||
        typeof point.y !== "number" ||
        !Number.isFinite(point.y) ||
        point.x < minX || point.x > maxX ||
        point.y < minY || point.y > maxY ||
        typeof z !== "number" ||
        !Number.isInteger(z) ||
        z < 0 ||
        !layers.has(z)
      ) {
        return false
      }
    }
    for (const [point, originalPoint] of [
      [points[0]!, original.route![0]!],
      [points.at(-1)!, original.route!.at(-1)!],
    ] as const) {
      if (
        !nearlyEqual(point.x as number, originalPoint.x) ||
        !nearlyEqual(point.y as number, originalPoint.y) ||
        (point.z ?? 0) !== (originalPoint.z ?? 0)
      ) {
        return false
      }
    }
    for (const value of route.vias) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false
      const via = value as Record<string, unknown>
      if (
        typeof via.x !== "number" ||
        !Number.isFinite(via.x) ||
        typeof via.y !== "number" ||
        !Number.isFinite(via.y) ||
        via.x < minX || via.x > maxX ||
        via.y < minY || via.y > maxY ||
        (via.diameter !== undefined && via.diameter !== original.viaDiameter)
      ) {
        return false
      }
    }
    const routeWithExplicitLayers = {
      ...route,
      route: points.map((point) => ({ ...point, z: point.z ?? 0 })),
    } as unknown as HighDensityIntraNodeRoute
    if (!hasValidRemoteLayerTransitions(routeWithExplicitLayers, "ordinary")) {
      return false
    }
  }
  return true
}

export const getHdCache2SolveUrl = (baseUrl: string): string =>
  /\/solve\/?$/.test(baseUrl)
    ? baseUrl.replace(/\/+$/, "")
    : `${baseUrl.replace(/\/+$/, "")}/solve`

export const getHdCache2SolveBatchUrl = (baseUrl: string): string => {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")
  if (/\/solve-batch$/.test(normalizedBaseUrl)) return normalizedBaseUrl
  if (/\/solve$/.test(normalizedBaseUrl)) {
    return normalizedBaseUrl.replace(/\/solve$/, "/solve-batch")
  }
  return `${normalizedBaseUrl}/solve-batch`
}

export class HdCache2Client {
  readonly cacheVersion?: string
  readonly stats: HdCache2ClientStats = {
    batchRequestsStarted: 0,
    batchRequestsCompleted: 0,
    batchItemsStarted: 0,
    batchBodyBytesStarted: 0,
    batchMaxBodyBytes: 0,
    batchCacheMisses: 0,
    singleRequestsStarted: 0,
    batchInvalidLines: 0,
    batchUnknownRequestIds: 0,
    batchDuplicateRequestIds: 0,
  }

  constructor(
    readonly autorouterVersion: string,
    readonly serverUrl: string = DEFAULT_HD_CACHE2_SERVER_URL,
    options: HdCache2ClientOptions = {},
  ) {
    const { cacheVersion } = options
    if (cacheVersion !== undefined && cacheVersion.trim().length === 0) {
      throw new Error("hd-cache2 cacheVersion must not be empty")
    }
    this.cacheVersion = cacheVersion
  }

  /**
   * Launches all exact-cache lookups together. Each returned promise resolves
   * independently as its NDJSON result (or local-fallback reason) arrives.
   */
  solveMany(
    inputs: readonly Pipeline9NetworkedHighDensityNodeInput[],
  ): Array<Promise<HdCache2SolveResult>>
  solveMany(
    inputs: readonly Pipeline9NetworkedHighDensityRepairInput[],
  ): Array<Promise<HdCache2RepairSolveResult>>
  solveMany(
    inputs: readonly Pipeline9NetworkedInput[],
  ): Array<Promise<HdCache2SolveResult<Pipeline9NetworkedOutput>>>
  solveMany(
    inputs: readonly Pipeline9NetworkedInput[],
  ): Array<Promise<HdCache2SolveResult<Pipeline9NetworkedOutput>>> {
    const pendingSolves = inputs.map((input, index) =>
      this.createPendingSolve(String(index), input),
    )
    const serializableSolves = pendingSolves.filter(
      (pending): pending is PendingSolve & { serializedItem: string } =>
        pending.serializedItem !== null,
    )
    const { batches, singletonSolves } = this.prepareBatches(serializableSolves)

    for (const batch of batches) void this.fetchBatch(batch)
    for (const pending of singletonSolves) this.launchSingleSolve(pending)

    return pendingSolves.map((pending) => pending.promise)
  }

  private createPendingSolve(
    requestId: string,
    input: Pipeline9NetworkedInput,
  ): PendingSolve {
    let resolve!: (result: HdCache2SolveResult<Pipeline9NetworkedOutput>) => void
    const promise = new Promise<HdCache2SolveResult<Pipeline9NetworkedOutput>>((resolvePromise) => {
      resolve = resolvePromise
    })
    const pending: PendingSolve = {
      requestId,
      input,
      serializedItem: null,
      promise,
      resolve,
      settled: false,
      singleSolveStarted: false,
    }
    try {
      pending.serializedItem = JSON.stringify({ requestId, input })
      // A cache miss must send and validate the same sample as the batch lookup,
      // even if the caller subsequently mutates its route or fixed-copper arrays.
      if (input.solvePolicy === PIPELINE9_NETWORKED_REPAIR_POLICY) {
        pending.input = JSON.parse(pending.serializedItem).input
      }
    } catch (error) {
      this.settleWithFallback(
        pending,
        "request_serialization_error",
        getErrorMessage(error),
      )
    }
    return pending
  }

  private settle(
    pending: PendingSolve,
    result: HdCache2SolveResult<Pipeline9NetworkedOutput>,
  ): void {
    if (pending.settled) return
    pending.settled = true
    pending.resolve(result)
  }

  private settleWithFallback(
    pending: PendingSolve,
    reason: HdCache2FallbackReason,
    error: string,
  ): void {
    this.settle(pending, { kind: "local-fallback", reason, error })
  }

  private parseSuccessfulResponse(
    value: unknown,
    input: Pipeline9NetworkedInput,
  ): Extract<Pipeline9NetworkedSolveResponse<Pipeline9NetworkedOutput>, { ok: true }> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new HdCache2RequestError(
        "invalid_response",
        "hd-cache2 returned a non-object response",
      )
    }

    const response = value as Record<string, unknown>
    if (response.ok !== true) {
      throw new HdCache2RequestError(
        "remote_error",
        typeof response.message === "string"
          ? response.message
          : "hd-cache2 returned an unsuccessful response",
      )
    }
    if (response.autorouterVersion !== this.autorouterVersion) {
      throw new HdCache2RequestError(
        "version_mismatch",
        `hd-cache2 returned autorouter version ${String(response.autorouterVersion)}, expected ${this.autorouterVersion}`,
      )
    }
    if (response.cacheVersion !== this.cacheVersion) {
      throw new HdCache2RequestError(
        "cache_version_mismatch",
        `hd-cache2 returned cache version ${String(response.cacheVersion)}, expected ${String(this.cacheVersion)}`,
      )
    }
    if (response.source !== "cache" && response.source !== "solver") {
      throw new HdCache2RequestError(
        "invalid_response",
        "hd-cache2 returned an invalid cache source",
      )
    }
    if (input.solvePolicy === PIPELINE9_NETWORKED_REPAIR_POLICY) {
      if (!isValidRemoteRepairResult(response, input)) {
        throw new HdCache2RequestError(
          "invalid_response",
          "hd-cache2 returned an invalid repair result",
        )
      }
      return response as Extract<Pipeline9NetworkedSolveResponse<Pipeline9NetworkedHighDensityRepairOutput>, { ok: true }>
    }
    if (
      response.solutionStage !== "ordinary" &&
      response.solutionStage !== "regional-fallback"
    ) {
      throw new HdCache2RequestError(
        "invalid_response",
        "hd-cache2 returned an invalid solution stage",
      )
    }
    if (
      response.solutionStage === "regional-fallback" &&
      (!input.enableRegionalFallback ||
        typeof response.ordinaryFailure !== "string" ||
        response.ordinaryFailure.length === 0)
    ) {
      throw new HdCache2RequestError(
        "invalid_response",
        "hd-cache2 returned invalid regional fallback metadata",
      )
    }
    if (
      response.solutionStage === "ordinary" &&
      Object.prototype.hasOwnProperty.call(response, "ordinaryFailure")
    ) {
      throw new HdCache2RequestError(
        "invalid_response",
        "hd-cache2 returned regional metadata on an ordinary result",
      )
    }
    if (
      response.solutionStage === "ordinary" &&
      response.status === "failed" &&
      input.enableRegionalFallback
    ) {
      throw new HdCache2RequestError(
        "invalid_response",
        "hd-cache2 returned an intermediate ordinary failure",
      )
    }
    if (
      response.status === "solved" &&
      (input.forceImprove === undefined
        ? response.forceImproved !== undefined
        : response.forceImproved !== true)
    ) {
      throw new HdCache2RequestError(
        "invalid_response",
        "hd-cache2 returned invalid force improvement metadata",
      )
    }
    if (
      response.status === "solved" &&
      isValidRemoteRoutes(response.routes, input, response.solutionStage)
    ) {
      return response as Extract<Pipeline9NetworkedSolveResponse, { ok: true }>
    }
    if (
      response.status === "failed" &&
      typeof response.error === "string" &&
      response.error.length > 0
    ) {
      return response as Extract<Pipeline9NetworkedSolveResponse, { ok: true }>
    }

    throw new HdCache2RequestError(
      "invalid_response",
      "hd-cache2 returned an invalid solve result",
    )
  }

  private parseBatchCacheMiss(
    value: Record<string, unknown>,
  ): Pipeline9NetworkedSolveBatchCacheMiss | null {
    if (value.ok !== false || value.code !== "CACHE_MISS") return null
    if (value.autorouterVersion !== this.autorouterVersion) {
      throw new HdCache2RequestError(
        "version_mismatch",
        `hd-cache2 returned autorouter version ${String(value.autorouterVersion)}, expected ${this.autorouterVersion}`,
      )
    }
    if (value.cacheVersion !== this.cacheVersion) {
      throw new HdCache2RequestError(
        "cache_version_mismatch",
        `hd-cache2 returned cache version ${String(value.cacheVersion)}, expected ${String(this.cacheVersion)}`,
      )
    }
    if (typeof value.message !== "string") {
      throw new HdCache2RequestError(
        "invalid_response",
        "hd-cache2 returned an invalid cache miss response",
      )
    }
    return value as Pipeline9NetworkedSolveBatchCacheMiss
  }

  private async fetchSingle(pending: PendingSolve): Promise<void> {
    const controller = new AbortController()
    let didTransportTimeout = false
    const timeoutId = setTimeout(() => {
      didTransportTimeout = true
      controller.abort(
        new Error(
          `hd-cache2 transport timed out after ${HD_CACHE2_TRANSPORT_TIMEOUT_MS}ms`,
        ),
      )
    }, HD_CACHE2_TRANSPORT_TIMEOUT_MS)
    ;(
      timeoutId as ReturnType<typeof setTimeout> & { unref?: () => void }
    ).unref?.()

    try {
      const request: Pipeline9NetworkedSolveRequest<Pipeline9NetworkedInput> = {
        autorouterVersion: this.autorouterVersion,
        ...(this.cacheVersion === undefined
          ? {}
          : { cacheVersion: this.cacheVersion }),
        input: pending.input,
      }
      let body: string
      try {
        body = JSON.stringify(request)
      } catch (error) {
        throw new HdCache2RequestError(
          "request_serialization_error",
          getErrorMessage(error),
        )
      }
      const response = await fetch(getHdCache2SolveUrl(this.serverUrl), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body,
        signal: controller.signal,
      })
      const responseText = await response.text()
      let responseBody: unknown = null
      try {
        responseBody = responseText ? JSON.parse(responseText) : null
      } catch {
        if (!response.ok) {
          throw new HdCache2RequestError(
            "http_error",
            `hd-cache2 request failed with status ${response.status}`,
          )
        }
        throw new HdCache2RequestError(
          "invalid_json",
          `hd-cache2 returned invalid JSON with status ${response.status}`,
        )
      }
      if (!response.ok) {
        const message =
          responseBody &&
          typeof responseBody === "object" &&
          "message" in responseBody &&
          typeof responseBody.message === "string"
            ? responseBody.message
            : `hd-cache2 request failed with status ${response.status}`
        throw new HdCache2RequestError("http_error", message)
      }
      this.settle(pending, {
        kind: "remote",
        response: this.parseSuccessfulResponse(responseBody, pending.input),
      })
    } catch (error) {
      const reason =
        error instanceof HdCache2RequestError
          ? error.reason
          : didTransportTimeout
            ? "transport_timeout"
            : "transport_error"
      this.settleWithFallback(pending, reason, getErrorMessage(error))
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private launchSingleSolve(pending: PendingSolve): void {
    if (pending.singleSolveStarted || pending.settled) return
    pending.singleSolveStarted = true
    this.stats.singleRequestsStarted += 1
    void this.fetchSingle(pending)
  }

  private handleBatchResponseLine(
    line: string,
    itemsByRequestId: ReadonlyMap<string, PendingSolve>,
    responseRequestIds: Set<string>,
  ): void {
    if (line.trim().length === 0) return
    if (line.length > MAX_RESPONSE_LINE_CHARACTERS) {
      throw new HdCache2RequestError(
        "response_too_large",
        "hd-cache2 returned an oversized batch result line",
      )
    }

    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      this.stats.batchInvalidLines += 1
      return
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      this.stats.batchInvalidLines += 1
      return
    }

    const responseValue = value as Record<string, unknown>
    const requestId = responseValue.requestId
    if (typeof requestId !== "string") {
      this.stats.batchInvalidLines += 1
      return
    }
    const pending = itemsByRequestId.get(requestId)
    if (!pending) {
      this.stats.batchUnknownRequestIds += 1
      return
    }
    if (responseRequestIds.has(requestId)) {
      this.stats.batchDuplicateRequestIds += 1
      return
    }
    responseRequestIds.add(requestId)

    try {
      const cacheMiss = this.parseBatchCacheMiss(responseValue)
      if (cacheMiss) {
        this.stats.batchCacheMisses += 1
        this.launchSingleSolve(pending)
        return
      }
      this.settle(pending, {
        kind: "remote",
        response: this.parseSuccessfulResponse(responseValue, pending.input),
      })
    } catch (error) {
      this.stats.batchInvalidLines += 1
      this.settleWithFallback(
        pending,
        error instanceof HdCache2RequestError
          ? error.reason
          : "invalid_response",
        getErrorMessage(error),
      )
    }
  }

  private async readBatchResponse(
    response: Response,
    batch: PreparedBatch,
  ): Promise<void> {
    if (!response.body) {
      throw new HdCache2RequestError(
        "invalid_response",
        "hd-cache2 returned an empty batch response body",
      )
    }

    const itemsByRequestId = new Map(
      batch.items.map((item) => [item.requestId, item]),
    )
    const responseRequestIds = new Set<string>()
    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    let buffer = ""

    while (responseRequestIds.size < batch.items.length) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      if (
        buffer.length > MAX_RESPONSE_LINE_CHARACTERS &&
        !buffer.includes("\n")
      ) {
        throw new HdCache2RequestError(
          "response_too_large",
          "hd-cache2 returned an oversized unterminated batch result line",
        )
      }

      let newlineIndex = buffer.indexOf("\n")
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        this.handleBatchResponseLine(line, itemsByRequestId, responseRequestIds)
        newlineIndex = buffer.indexOf("\n")
      }
      if (!done) continue
      if (buffer.trim().length > 0) {
        this.handleBatchResponseLine(
          buffer,
          itemsByRequestId,
          responseRequestIds,
        )
      }
      break
    }

    if (responseRequestIds.size === batch.items.length) {
      await reader.cancel().catch(() => {})
      return
    }
    for (const pending of batch.items) {
      if (responseRequestIds.has(pending.requestId)) continue
      this.settleWithFallback(
        pending,
        "missing_response",
        `hd-cache2 batch ended without result ${pending.requestId}`,
      )
    }
  }

  private async fetchBatch(batch: PreparedBatch): Promise<void> {
    const controller = new AbortController()
    let didTransportTimeout = false
    const timeoutId = setTimeout(() => {
      didTransportTimeout = true
      controller.abort(
        new Error(
          `hd-cache2 batch transport timed out after ${HD_CACHE2_TRANSPORT_TIMEOUT_MS}ms`,
        ),
      )
    }, HD_CACHE2_TRANSPORT_TIMEOUT_MS)
    ;(
      timeoutId as ReturnType<typeof setTimeout> & { unref?: () => void }
    ).unref?.()

    this.stats.batchRequestsStarted += 1
    this.stats.batchItemsStarted += batch.items.length
    this.stats.batchBodyBytesStarted += batch.bodyBytes
    this.stats.batchMaxBodyBytes = Math.max(
      this.stats.batchMaxBodyBytes,
      batch.bodyBytes,
    )

    try {
      const response = await fetch(getHdCache2SolveBatchUrl(this.serverUrl), {
        method: "POST",
        headers: {
          accept: "application/x-ndjson",
          "content-type": "application/json",
        },
        body: batch.body,
        signal: controller.signal,
      })
      if (!response.ok) {
        const responseText = await response.text().catch(() => "")
        let message = `hd-cache2 batch request failed with status ${response.status}`
        try {
          const responseBody = responseText ? JSON.parse(responseText) : null
          if (
            responseBody &&
            typeof responseBody === "object" &&
            "message" in responseBody &&
            typeof responseBody.message === "string"
          ) {
            message = responseBody.message
          }
        } catch {}
        throw new HdCache2RequestError("http_error", message)
      }
      await this.readBatchResponse(response, batch)
    } catch (error) {
      const reason =
        error instanceof HdCache2RequestError
          ? error.reason
          : didTransportTimeout
            ? "transport_timeout"
            : "transport_error"
      for (const pending of batch.items) {
        if (pending.singleSolveStarted) continue
        this.settleWithFallback(pending, reason, getErrorMessage(error))
      }
    } finally {
      clearTimeout(timeoutId)
      this.stats.batchRequestsCompleted += 1
    }
  }

  private prepareBatches(
    items: Array<PendingSolve & { serializedItem: string }>,
  ): {
    batches: PreparedBatch[]
    singletonSolves: PendingSolve[]
  } {
    const encoder = new TextEncoder()
    const cacheVersionField =
      this.cacheVersion === undefined
        ? ""
        : `,"cacheVersion":${JSON.stringify(this.cacheVersion)}`
    const prefix = `{"autorouterVersion":${JSON.stringify(this.autorouterVersion)}${cacheVersionField},"items":[`
    const suffix = "]}"
    const fixedBytes = encoder.encode(prefix + suffix).byteLength
    const batches: PreparedBatch[] = []
    const singletonSolves: PendingSolve[] = []
    let currentItems: PendingSolve[] = []
    let currentBytes = fixedBytes

    const flushCurrentBatch = (): void => {
      if (currentItems.length === 0) return
      batches.push({
        body: `${prefix}${currentItems.map((item) => item.serializedItem).join(",")}${suffix}`,
        bodyBytes: currentBytes,
        items: currentItems,
      })
      currentItems = []
      currentBytes = fixedBytes
    }

    for (const item of items) {
      const itemBytes = encoder.encode(item.serializedItem).byteLength
      const separatorBytes = currentItems.length === 0 ? 0 : 1
      if (fixedBytes + itemBytes > HD_CACHE2_MAX_BATCH_BODY_BYTES) {
        flushCurrentBatch()
        singletonSolves.push(item)
        continue
      }
      if (
        currentItems.length >= HD_CACHE2_MAX_BATCH_ITEMS ||
        currentBytes + separatorBytes + itemBytes >
          HD_CACHE2_MAX_BATCH_BODY_BYTES
      ) {
        flushCurrentBatch()
      }
      currentItems.push(item)
      currentBytes += (currentItems.length === 1 ? 0 : 1) + itemBytes
    }
    flushCurrentBatch()
    return { batches, singletonSolves }
  }
}
