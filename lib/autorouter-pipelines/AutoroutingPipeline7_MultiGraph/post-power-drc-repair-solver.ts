import { checkViaPadClearance, checkViasInPads } from "@tscircuit/checks"
import {
  getSegmentIntersection,
  pointToSegmentClosestPoint,
} from "@tscircuit/math-utils"
import type { AnyCircuitElement } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { combinePreloadedAndRoutedTraces } from "lib/testing/evaluate-relaxed-drc"
import {
  createDrcConnectivityMap,
  getDrcErrors,
} from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { JUMPER_DIMENSIONS } from "../../utils/jumperSizes"

type RoutePoint = SimplifiedPcbTrace["route"][number]
type WirePoint = Extract<RoutePoint, { route_type: "wire" }>
type ViaPoint = Extract<RoutePoint, { route_type: "via" }>
type Point = { x: number; y: number }
type LayerPoint = Point & { layer: string }
type AxisAlignedBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}
type WireSegment = {
  start: Point
  end: Point
  layer: string
  width: number
}
type CopperCapsule = {
  start: Point
  end: Point
  layer: string
  radius: number
}
type DrcErrorRecord = Record<string, unknown> & {
  type?: string
  center?: Point
  pcb_trace_id?: string
  pcb_via_id?: string
  pcb_pad_ids?: string[]
  pcb_port_ids?: string[]
}

export interface PostPowerDrcRepairSolverOptions {
  originalSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  traces: SimplifiedPcbTraces
  effort?: number
  maxCandidateEvaluations?: number
  maxRuntimeMs?: number
  maxLocalShiftRepairs?: number
  maxLayerLiftRepairs?: number
}

export interface PostPowerDrcRepairStats {
  initialDrcErrorCount: number
  finalDrcErrorCount: number
  initialViaInPadCount: number
  finalViaInPadCount: number
  initialGuardErrorCount: number
  finalGuardErrorCount: number
  candidateEvaluationCount: number
  acceptedCandidateCount: number
  acceptedViaRelocationCount: number
  acceptedViaInPadRelocationCount: number
  acceptedLocalShiftCount: number
  acceptedLayerLiftCount: number
  candidateBudgetExhausted: boolean
  runtimeBudgetExhausted: boolean
  unsupportedRouteTypes: string[]
  remainingDrcErrorIds: string[]
  remainingViaInPadIds: string[]
  remainingGuardErrorIds: string[]
}

type Evaluation = {
  circuitJson: AnyCircuitElement[]
  errorsWithCenters: DrcErrorRecord[]
  errorIds: string[]
  errorIdSet: Set<string>
  errorSeverityVectorsById: Map<string, number[]>
  guardErrorIds: string[]
  guardErrorSeverityVectorsById: Map<string, number[]>
  viaInPadIds: string[]
  viaInPadIdSet: Set<string>
  viaInPadConflicts: ViaInPadConflict[]
}

type CircuitPcbVia = AnyCircuitElement & {
  type: "pcb_via"
  pcb_via_id: string
  pcb_trace_id?: string
  x: number
  y: number
  layers: string[]
}

type ViaInPadConflict = {
  identity: string
  via: CircuitPcbVia
  pad?: AnyCircuitElement
  padId: string
}

const EPSILON = 1e-6
const GRID_STEP = 0.05
const DEFAULT_BOARD_EDGE_CLEARANCE = 0.2

const getRuntimeObstacleType = (
  obstacle: SimpleRouteJson["obstacles"][number],
): string => (obstacle as typeof obstacle & { type: string }).type

const obstacleIsOval = (
  obstacle: SimpleRouteJson["obstacles"][number],
): boolean => getRuntimeObstacleType(obstacle) === "oval"

const obstacleIsCircular = (
  obstacle: SimpleRouteJson["obstacles"][number],
): boolean =>
  obstacleIsOval(obstacle) &&
  Math.abs(obstacle.width - obstacle.height) <= EPSILON

const getObstacleAxisAlignedBounds = (
  obstacle: SimpleRouteJson["obstacles"][number],
): AxisAlignedBounds => {
  const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cosine = Math.abs(Math.cos(radians))
  const sine = Math.abs(Math.sin(radians))
  const halfWidth = (cosine * obstacle.width + sine * obstacle.height) / 2
  const halfHeight = (sine * obstacle.width + cosine * obstacle.height) / 2
  return {
    minX: obstacle.center.x - halfWidth,
    maxX: obstacle.center.x + halfWidth,
    minY: obstacle.center.y - halfHeight,
    maxY: obstacle.center.y + halfHeight,
  }
}

const toObstacleLocalPoint = (
  point: Point,
  obstacle: SimpleRouteJson["obstacles"][number],
): Point => {
  const radians = (-(obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const dx = point.x - obstacle.center.x
  const dy = point.y - obstacle.center.y
  return {
    x: dx * Math.cos(radians) - dy * Math.sin(radians),
    y: dx * Math.sin(radians) + dy * Math.cos(radians),
  }
}

const pointToEllipseDistance = (
  point: Point,
  obstacle: SimpleRouteJson["obstacles"][number],
): number => {
  const local = toObstacleLocalPoint(point, obstacle)
  const x = Math.abs(local.x)
  const y = Math.abs(local.y)
  const radiusX = obstacle.width / 2
  const radiusY = obstacle.height / 2
  if (radiusX <= EPSILON || radiusY <= EPSILON) return 0
  if ((x / radiusX) ** 2 + (y / radiusY) ** 2 <= 1 + EPSILON) return 0

  const radiusXSquared = radiusX * radiusX
  const radiusYSquared = radiusY * radiusY
  const equationAt = (parameter: number): number =>
    ((radiusX * x) / (parameter + radiusXSquared)) ** 2 +
    ((radiusY * y) / (parameter + radiusYSquared)) ** 2 -
    1
  let low = 0
  let high = Math.max(radiusX * x, radiusY * y, 1)
  while (equationAt(high) > 0) high *= 2
  for (let iteration = 0; iteration < 64; iteration++) {
    const middle = (low + high) / 2
    if (equationAt(middle) > 0) low = middle
    else high = middle
  }
  const parameter = high
  const closestX = (radiusXSquared * x) / (parameter + radiusXSquared)
  const closestY = (radiusYSquared * y) / (parameter + radiusYSquared)
  return Math.hypot(x - closestX, y - closestY)
}

const segmentToEllipseDistance = (
  start: Point,
  end: Point,
  obstacle: SimpleRouteJson["obstacles"][number],
): number => {
  const localStart = toObstacleLocalPoint(start, obstacle)
  const localEnd = toObstacleLocalPoint(end, obstacle)
  const radiusX = obstacle.width / 2
  const radiusY = obstacle.height / 2
  if (radiusX <= EPSILON || radiusY <= EPSILON) return 0
  const dx = localEnd.x - localStart.x
  const dy = localEnd.y - localStart.y
  const quadraticA = (dx / radiusX) ** 2 + (dy / radiusY) ** 2
  const quadraticB =
    (2 * localStart.x * dx) / (radiusX * radiusX) +
    (2 * localStart.y * dy) / (radiusY * radiusY)
  const quadraticC =
    (localStart.x / radiusX) ** 2 + (localStart.y / radiusY) ** 2 - 1
  if (quadraticC <= EPSILON) return 0
  if (quadraticA > EPSILON) {
    const discriminant = quadraticB * quadraticB - 4 * quadraticA * quadraticC
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant)
      const first = (-quadraticB - root) / (2 * quadraticA)
      const second = (-quadraticB + root) / (2 * quadraticA)
      if (
        (first >= -EPSILON && first <= 1 + EPSILON) ||
        (second >= -EPSILON && second <= 1 + EPSILON)
      )
        return 0
    }
  }
  let low = 0
  let high = 1
  const distanceAt = (ratio: number): number =>
    pointToEllipseDistance(
      {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      },
      obstacle,
    )
  for (let iteration = 0; iteration < 64; iteration++) {
    const first = low + (high - low) / 3
    const second = high - (high - low) / 3
    if (distanceAt(first) <= distanceAt(second)) high = second
    else low = first
  }
  return Math.min(distanceAt(0), distanceAt(1), distanceAt((low + high) / 2))
}

const pointsEqual = (a: Point, b: Point): boolean =>
  Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON

export const getDrcErrorIdentity = (error: DrcErrorRecord): string => {
  for (const [key, value] of Object.entries(error)) {
    if (key.endsWith("_error_id") && typeof value === "string") return value
  }
  const message = typeof error.message === "string" ? error.message : ""
  return `${error.type ?? "unknown_drc_error"}:${message}`
}

export const isStrictErrorIdentitySubset = (
  beforeIds: Iterable<string>,
  candidateIds: Iterable<string>,
): boolean => {
  const before = new Set(beforeIds)
  const candidate = [...candidateIds]
  return (
    candidate.length < before.size && candidate.every((id) => before.has(id))
  )
}

const isIdentitySubset = (
  beforeIds: ReadonlySet<string>,
  candidateIds: Iterable<string>,
): boolean => [...candidateIds].every((id) => beforeIds.has(id))

const getDrcErrorSeverity = (error: DrcErrorRecord): number => {
  const minimum = error.minimum_clearance
  const actual = error.actual_clearance
  if (typeof minimum === "number" && typeof actual === "number") {
    return Math.max(0, minimum - actual)
  }
  return 1
}

const getErrorSeverityVectorsById = (
  errors: DrcErrorRecord[],
): Map<string, number[]> => {
  const state = new Map<string, number[]>()
  for (const error of errors) {
    const id = getDrcErrorIdentity(error)
    const severities = state.get(id) ?? []
    severities.push(getDrcErrorSeverity(error))
    state.set(id, severities)
  }
  for (const severities of state.values()) severities.sort((a, b) => b - a)
  return state
}

const isErrorStateSubsetWithoutWorsening = (
  before: ReadonlyMap<string, number[]>,
  candidate: ReadonlyMap<string, number[]>,
): boolean =>
  [...candidate].every(([id, candidateSeverities]) => {
    const beforeSeverities = before.get(id)
    return (
      beforeSeverities !== undefined &&
      candidateSeverities.length <= beforeSeverities.length &&
      candidateSeverities.every(
        (severity, index) => severity <= beforeSeverities[index]! + EPSILON,
      )
    )
  })

export const createRadialGridOffsets = ({
  minDistance = 0.2,
  maxDistance,
  step = GRID_STEP,
  maxCandidates,
}: {
  minDistance?: number
  maxDistance: number
  step?: number
  maxCandidates?: number
}): Array<{ dx: number; dy: number; distance: number }> => {
  const cellRadius = Math.ceil(maxDistance / step)
  const candidates: Array<{ dx: number; dy: number; distance: number }> = []
  for (let dxCell = -cellRadius; dxCell <= cellRadius; dxCell++) {
    for (let dyCell = -cellRadius; dyCell <= cellRadius; dyCell++) {
      const dx = dxCell * step
      const dy = dyCell * step
      const distance = Math.hypot(dx, dy)
      if (distance < minDistance || distance > maxDistance) continue
      candidates.push({ dx, dy, distance })
    }
  }
  candidates.sort(
    (a, b) => a.distance - b.distance || a.dx - b.dx || a.dy - b.dy,
  )
  if (maxCandidates === undefined || candidates.length <= maxCandidates)
    return candidates
  if (maxCandidates <= 0) return []
  if (maxCandidates === 1) return [candidates[0]!]

  // Keep a dense near-field search, then sample the remaining sorted radii
  // through the requested outer bound. Nearest-only truncation made a nominal
  // 2mm search stop around 0.32mm when capped at 80 candidates.
  const nearCount = Math.max(1, Math.floor(maxCandidates / 2))
  const sampled = candidates.slice(0, nearCount)
  const outerSlots = maxCandidates - nearCount
  for (let slot = 0; slot < outerSlots; slot++) {
    const ratio = outerSlots === 1 ? 1 : slot / (outerSlots - 1)
    const index = Math.round(
      nearCount + ratio * (candidates.length - 1 - nearCount),
    )
    sampled.push(candidates[index]!)
  }
  return sampled
}

export const createOffsetsAwayFromPoint = ({
  origin,
  obstacleCenter,
  minDistance = 0.2,
  maxDistance = 1,
  step = GRID_STEP,
}: {
  origin: Point
  obstacleCenter: Point
  minDistance?: number
  maxDistance?: number
  step?: number
}): Array<{ dx: number; dy: number; distance: number }> => {
  const rawX = origin.x - obstacleCenter.x
  const rawY = origin.y - obstacleCenter.y
  const magnitude = Math.hypot(rawX, rawY)
  const unitX = magnitude <= EPSILON ? 1 : rawX / magnitude
  const unitY = magnitude <= EPSILON ? 0 : rawY / magnitude
  const angles = [0, Math.PI / 8, -Math.PI / 8, Math.PI / 4, -Math.PI / 4]
  const offsets: Array<{ dx: number; dy: number; distance: number }> = []
  for (
    let distance = minDistance;
    distance <= maxDistance + EPSILON;
    distance += step
  ) {
    for (const angle of angles) {
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      offsets.push({
        dx: distance * (unitX * cos - unitY * sin),
        dy: distance * (unitX * sin + unitY * cos),
        distance,
      })
    }
  }
  return offsets
}

const copyRoutePointAt = (point: RoutePoint, position: Point): RoutePoint => {
  if (point.route_type !== "wire" && point.route_type !== "via") return point
  return { ...point, ...position }
}

const getMovableVertexIndices = (
  route: RoutePoint[],
  center: Point,
  selectionRadius: number,
): number[] => {
  const selected = new Set<number>()
  for (let index = 1; index < route.length - 1; index++) {
    const point = route[index]
    if (
      point &&
      (point.route_type === "wire" || point.route_type === "via") &&
      Math.hypot(point.x - center.x, point.y - center.y) <= selectionRadius
    ) {
      selected.add(index)
    }
  }

  // A via and its duplicate wire endpoints are one topological vertex.
  for (let viaIndex = 1; viaIndex < route.length - 1; viaIndex++) {
    const via = route[viaIndex]
    if (via?.route_type !== "via") continue
    const vertexIndices = [viaIndex - 1, viaIndex, viaIndex + 1]
    if (vertexIndices.some((index) => selected.has(index))) {
      for (const index of vertexIndices) selected.add(index)
    }
  }

  return [...selected].sort((a, b) => a - b)
}

export const translateLocalTraceVertices = ({
  trace,
  center,
  selectionRadius,
  dx,
  dy,
}: {
  trace: SimplifiedPcbTrace
  center: Point
  selectionRadius: number
  dx: number
  dy: number
}): SimplifiedPcbTrace | null => {
  const route = structuredClone(trace.route)
  const movableIndices = getMovableVertexIndices(route, center, selectionRadius)
  if (movableIndices.length === 0) return null
  for (const index of movableIndices) {
    const point = route[index]!
    if (point.route_type !== "wire" && point.route_type !== "via") return null
    route[index] = copyRoutePointAt(point, {
      x: point.x + dx,
      y: point.y + dy,
    })
  }
  return { ...trace, route }
}

const distanceToSegment = (point: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const denominator = dx * dx + dy * dy
  const t =
    denominator === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator,
          ),
        )
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

export const liftLocalTraceWindow = ({
  trace,
  center,
  padding,
  targetLayer,
}: {
  trace: SimplifiedPcbTrace
  center: Point
  padding: number
  targetLayer: string
}): SimplifiedPcbTrace | null => {
  const route = structuredClone(trace.route)
  const closestSegment = route
    .slice(0, -1)
    .flatMap((point, index) => {
      const next = route[index + 1]
      return point?.route_type === "wire" &&
        next?.route_type === "wire" &&
        point.layer === next.layer
        ? [{ index, distance: distanceToSegment(center, point, next) }]
        : []
    })
    .sort((a, b) => a.distance - b.distance)[0]
  if (!closestSegment) return null

  const startIndex = Math.max(1, closestSegment.index - padding)
  const endIndex = Math.min(
    route.length - 2,
    closestSegment.index + padding + 1,
  )
  const window = route.slice(startIndex, endIndex + 1)
  const start = window[0]
  const end = window.at(-1)
  if (
    start?.route_type !== "wire" ||
    end?.route_type !== "wire" ||
    targetLayer === start.layer ||
    !window.every(
      (point): point is WirePoint =>
        point.route_type === "wire" && point.layer === start.layer,
    )
  ) {
    return null
  }

  const liftedWindow: WirePoint[] = window.map((point) => ({
    ...point,
    layer: targetLayer,
  }))
  return {
    ...trace,
    route: [
      ...route.slice(0, startIndex + 1),
      {
        route_type: "via",
        x: start.x,
        y: start.y,
        from_layer: start.layer,
        to_layer: targetLayer,
      },
      ...liftedWindow,
      {
        route_type: "via",
        x: end.x,
        y: end.y,
        from_layer: targetLayer,
        to_layer: end.layer,
      },
      ...route.slice(endIndex),
    ],
  }
}

const getWireWidthCounts = (trace: SimplifiedPcbTrace): Map<number, number> => {
  const counts = new Map<number, number>()
  for (const point of trace.route) {
    if (point.route_type !== "wire") continue
    counts.set(point.width, (counts.get(point.width) ?? 0) + 1)
  }
  return counts
}

const hasPreservedWireWidths = (
  before: SimplifiedPcbTrace,
  candidate: SimplifiedPcbTrace,
): boolean => {
  const beforeCounts = getWireWidthCounts(before)
  const candidateCounts = getWireWidthCounts(candidate)
  return [...beforeCounts].every(
    ([width, count]) => (candidateCounts.get(width) ?? 0) >= count,
  )
}

export const isTraceRouteContiguous = (trace: SimplifiedPcbTrace): boolean => {
  const { route } = trace
  if (route.length < 2) return false
  for (let index = 0; index < route.length; index++) {
    const point = route[index]!
    if (point.route_type === "via") {
      const previous = route[index - 1]
      const next = route[index + 1]
      if (
        previous?.route_type !== "wire" ||
        next?.route_type !== "wire" ||
        !pointsEqual(previous, point) ||
        !pointsEqual(next, point)
      ) {
        return false
      }
      const forward =
        previous.layer === point.from_layer && next.layer === point.to_layer
      const reverse =
        previous.layer === point.to_layer && next.layer === point.from_layer
      if (!forward && !reverse) return false
    }
    const next = route[index + 1]
    if (
      point.route_type === "wire" &&
      next?.route_type === "wire" &&
      point.layer !== next.layer
    ) {
      return false
    }
  }
  return true
}

const getTraceMetadata = (
  trace: SimplifiedPcbTrace,
): Omit<SimplifiedPcbTrace, "route"> => ({
  type: trace.type,
  pcb_trace_id: trace.pcb_trace_id,
  __replaces_pcb_trace_id: trace.__replaces_pcb_trace_id,
  connection_name: trace.connection_name,
  connectsTo: trace.connectsTo,
})

export const hasPreservedTraceStructure = (
  before: SimplifiedPcbTrace,
  candidate: SimplifiedPcbTrace,
): boolean => {
  const beforeStart = before.route[0]
  const beforeEnd = before.route.at(-1)
  const candidateStart = candidate.route[0]
  const candidateEnd = candidate.route.at(-1)
  return (
    JSON.stringify(getTraceMetadata(before)) ===
      JSON.stringify(getTraceMetadata(candidate)) &&
    JSON.stringify(beforeStart) === JSON.stringify(candidateStart) &&
    JSON.stringify(beforeEnd) === JSON.stringify(candidateEnd) &&
    hasPreservedWireWidths(before, candidate) &&
    isTraceRouteContiguous(candidate)
  )
}

const getCircuitPadId = (element: AnyCircuitElement): string | undefined => {
  if (
    element.type === "pcb_smtpad" &&
    typeof element.pcb_smtpad_id === "string"
  )
    return element.pcb_smtpad_id
  if (
    element.type === "pcb_plated_hole" &&
    typeof element.pcb_plated_hole_id === "string"
  )
    return element.pcb_plated_hole_id
  return undefined
}

const getCircuitElementNumber = (
  element: AnyCircuitElement,
  key: string,
): number | undefined => {
  const value = (element as unknown as Record<string, unknown>)[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

const getCircuitPadLayers = (pad: AnyCircuitElement): string[] => {
  if (pad.type === "pcb_smtpad") return [pad.layer]
  if (pad.type === "pcb_plated_hole") return [...pad.layers]
  return []
}

const circuitPadMatchesObstacle = (
  pad: AnyCircuitElement,
  obstacle: SimpleRouteJson["obstacles"][number],
): boolean => {
  if (pad.type !== "pcb_smtpad" && pad.type !== "pcb_plated_hole") return false
  const x = getCircuitElementNumber(pad, "x")
  const y = getCircuitElementNumber(pad, "y")
  const outerDiameter = getCircuitElementNumber(pad, "outer_diameter")
  const radius = getCircuitElementNumber(pad, "radius")
  const width =
    getCircuitElementNumber(pad, "width") ??
    getCircuitElementNumber(pad, "outer_width") ??
    getCircuitElementNumber(pad, "rect_pad_width") ??
    outerDiameter ??
    (radius === undefined ? undefined : radius * 2)
  const height =
    getCircuitElementNumber(pad, "height") ??
    getCircuitElementNumber(pad, "outer_height") ??
    getCircuitElementNumber(pad, "rect_pad_height") ??
    outerDiameter ??
    (radius === undefined ? undefined : radius * 2)
  const rotation =
    getCircuitElementNumber(pad, "ccw_rotation") ??
    getCircuitElementNumber(pad, "rect_ccw_rotation") ??
    0
  const padLayers = getCircuitPadLayers(pad)
  return (
    x !== undefined &&
    y !== undefined &&
    width !== undefined &&
    height !== undefined &&
    Math.abs(x - obstacle.center.x) <= EPSILON &&
    Math.abs(y - obstacle.center.y) <= EPSILON &&
    Math.abs(width - obstacle.width) <= EPSILON &&
    Math.abs(height - obstacle.height) <= EPSILON &&
    Math.abs(rotation - (obstacle.ccwRotationDegrees ?? 0)) <= EPSILON &&
    padLayers.length === obstacle.layers.length &&
    padLayers.every((layer) => obstacle.layers.includes(layer))
  )
}

const obstacleContainsConnectedDeclaredTerminal = (
  obstacle: SimpleRouteJson["obstacles"][number],
  srj: SimpleRouteJson,
): boolean =>
  srj.connections.some((connection) => {
    const connectionAliases = [
      connection.name,
      ...(connection.__rootConnectionNames ?? []),
      ...(connection.__netConnectionName
        ? [connection.__netConnectionName]
        : []),
    ]
    return connection.pointsToConnect.some((point) => {
      const pointAliases = [
        ...connectionAliases,
        ...(point.pointId ? [point.pointId] : []),
        ...("pcb_port_id" in point && point.pcb_port_id
          ? [point.pcb_port_id]
          : []),
      ]
      const pointLayers =
        "layers" in point && Array.isArray(point.layers)
          ? point.layers
          : "layer" in point
            ? [point.layer]
            : []
      return (
        pointAliases.some((id) => obstacle.connectedTo.includes(id)) &&
        pointLayers.some((layer) => obstacle.layers.includes(layer)) &&
        pointToObstacleDistance(point, obstacle) <= EPSILON
      )
    })
  })

const obstacleRepresentsAuthoritativeRoutingPad = (
  obstacle: SimpleRouteJson["obstacles"][number],
  srj: SimpleRouteJson,
): boolean => {
  if (obstacle.isCopperPour) return false
  return Boolean(
    obstacle.obstacleRole === "pad" ||
      obstacleContainsConnectedDeclaredTerminal(obstacle, srj),
  )
}

/**
 * Match converted pad records back to an explicit routing-domain role or
 * declared terminal geometry. Copper pours and component bodies are excluded.
 */
const getRoutingDomainPadIds = (
  circuitJson: AnyCircuitElement[],
  srj: SimpleRouteJson,
): Set<string> => {
  const routingPadIds = new Set<string>()
  const routingPadObstacles = srj.obstacles.filter(
    (obstacle) =>
      obstacleRepresentsAuthoritativeRoutingPad(obstacle, srj) &&
      // @tscircuit/checks currently treats oval pad containment as its
      // bounding rectangle. Exact ellipse policy is enforced directly
      // from SRJ below, so do not double-count a mismodeled oval record.
      (!obstacleIsOval(obstacle) || obstacleIsCircular(obstacle)),
  )
  for (const pad of circuitJson) {
    const padId = getCircuitPadId(pad)
    if (!padId) continue
    if (
      routingPadObstacles.some((obstacle) =>
        circuitPadMatchesObstacle(pad, obstacle),
      )
    )
      routingPadIds.add(padId)
  }
  return routingPadIds
}

/**
 * `convertToCircuitJson` can also create pad-shaped records for copper pours.
 * Apply pad-specific policy only to matching non-pour obstacle geometry.
 * Copper pours are dynamic fills whose clearance is resolved around routed
 * foreign copper, so they are intentionally excluded from fixed-pad checks.
 */
const keepOnlyRoutingDomainPadRecords = (
  circuitJson: AnyCircuitElement[],
  srj: SimpleRouteJson,
): AnyCircuitElement[] => {
  const padIds = getRoutingDomainPadIds(circuitJson, srj)
  return circuitJson.filter((element) => {
    const padId = getCircuitPadId(element)
    return padId === undefined || padIds.has(padId)
  })
}

const getCheckedViaInPadConflicts = ({
  circuitJson,
  srj,
  prefilteredCircuitJson,
}: {
  circuitJson: AnyCircuitElement[]
  srj: SimpleRouteJson
  prefilteredCircuitJson?: AnyCircuitElement[]
}): ViaInPadConflict[] => {
  if (srj.allowViaInPad) return []
  const circuitJsonToCheck =
    prefilteredCircuitJson ?? keepOnlyRoutingDomainPadRecords(circuitJson, srj)
  const rawCheckerErrors = checkViasInPads(circuitJsonToCheck)
  const checkerErrorIds = new Set(
    rawCheckerErrors.map((error) => error.pcb_placement_error_id),
  )
  const vias = circuitJsonToCheck.filter(
    (element): element is CircuitPcbVia =>
      element.type === "pcb_via" &&
      typeof element.pcb_via_id === "string" &&
      typeof element.x === "number" &&
      typeof element.y === "number" &&
      Array.isArray(element.layers),
  )
  const pads = circuitJsonToCheck.flatMap((element) => {
    const padId = getCircuitPadId(element)
    return padId ? [{ element, padId }] : []
  })
  const conflicts: ViaInPadConflict[] = []
  for (const via of vias) {
    for (const { element: pad, padId } of pads) {
      const checkerId = `via_in_pad_${via.pcb_via_id}_${padId}`
      if (!checkerErrorIds.has(checkerId)) continue
      conflicts.push({
        via,
        pad,
        padId,
        identity: [
          via.pcb_trace_id ?? via.pcb_via_id,
          via.x.toFixed(6),
          via.y.toFixed(6),
          via.layers.join("-"),
          padId,
        ].join(":"),
      })
    }
  }
  if (
    checkerErrorIds.size !== rawCheckerErrors.length ||
    conflicts.length !== rawCheckerErrors.length
  ) {
    throw new Error(
      `Via-in-pad checker accounting mismatch: ${rawCheckerErrors.length} raw error(s), ${checkerErrorIds.size} unique id(s), ${conflicts.length} mapped conflict(s)`,
    )
  }
  return conflicts.sort((a, b) => a.identity.localeCompare(b.identity))
}

export const getCheckedViaInPadIdentities = (options: {
  circuitJson: AnyCircuitElement[]
  srj: SimpleRouteJson
}): string[] =>
  getCheckedViaInPadConflicts(options).map((conflict) => conflict.identity)

const getSrjViaInPadConflicts = ({
  circuitJson,
  traces,
  srj,
}: {
  circuitJson: AnyCircuitElement[]
  traces: SimplifiedPcbTraces
  srj: SimpleRouteJson
}): ViaInPadConflict[] => {
  if (srj.allowViaInPad) return []
  const circuitVias = circuitJson.filter(
    (element): element is CircuitPcbVia =>
      element.type === "pcb_via" &&
      typeof element.pcb_via_id === "string" &&
      typeof element.x === "number" &&
      typeof element.y === "number" &&
      Array.isArray(element.layers),
  )
  const circuitPads = circuitJson.flatMap((element) =>
    getCircuitPadId(element) ? [element] : [],
  )
  const routingPadObstacles = srj.obstacles.flatMap(
    (obstacle, obstacleIndex) =>
      obstacleRepresentsAuthoritativeRoutingPad(obstacle, srj)
        ? [{ obstacle, obstacleIndex }]
        : [],
  )
  const conflicts: ViaInPadConflict[] = []
  for (const trace of traces) {
    for (let routeIndex = 0; routeIndex < trace.route.length; routeIndex++) {
      const point = trace.route[routeIndex]!
      if (point.route_type !== "via") continue
      const layers = getViaLayers(point, srj.layerCount)
      const circuitVia = circuitVias.find(
        (via) =>
          via.pcb_trace_id === trace.pcb_trace_id &&
          pointsEqual(via, point) &&
          layers.every((layer) => via.layers.includes(layer)),
      )
      const via: CircuitPcbVia =
        circuitVia ??
        ({
          type: "pcb_via",
          pcb_via_id: `srj_via_${trace.pcb_trace_id}_${routeIndex}`,
          pcb_trace_id: trace.pcb_trace_id,
          x: point.x,
          y: point.y,
          layers,
        } as CircuitPcbVia)
      for (const { obstacle, obstacleIndex } of routingPadObstacles) {
        if (
          !layers.some((layer) => obstacle.layers.includes(layer)) ||
          pointToObstacleDistance(point, obstacle) > EPSILON
        )
          continue
        const pad = circuitPads.find((candidate) =>
          circuitPadMatchesObstacle(candidate, obstacle),
        )
        const padId =
          (pad ? getCircuitPadId(pad) : undefined) ??
          obstacle.obstacleId ??
          `srj_obstacle_${obstacleIndex}`
        conflicts.push({
          via,
          pad,
          padId,
          identity: [
            trace.pcb_trace_id,
            point.x.toFixed(6),
            point.y.toFixed(6),
            layers.join("-"),
            padId,
          ].join(":"),
        })
      }
    }
  }
  return conflicts
}

export const getViaPadClearanceErrors = ({
  circuitJson,
  srj,
  supplementalConnMap,
  prefilteredCircuitJson,
}: {
  circuitJson: AnyCircuitElement[]
  srj: SimpleRouteJson
  supplementalConnMap: ConnectivityMap
  prefilteredCircuitJson?: AnyCircuitElement[]
}): DrcErrorRecord[] => {
  const circuitJsonToCheck =
    prefilteredCircuitJson ?? keepOnlyRoutingDomainPadRecords(circuitJson, srj)
  const connMap = createDrcConnectivityMap(
    circuitJsonToCheck,
    supplementalConnMap,
  )
  const viasById = new Map(
    circuitJsonToCheck.flatMap((element) =>
      element.type === "pcb_via" && typeof element.pcb_via_id === "string"
        ? [[element.pcb_via_id, element] as const]
        : [],
    ),
  )
  return checkViaPadClearance(circuitJsonToCheck, {
    connMap,
    minClearance: srj.minViaEdgeToPadEdgeClearance,
  }).map((error) => {
    const viaId = error.pcb_pad_ids.find((padId) => viasById.has(padId))
    const via = viaId ? viasById.get(viaId) : undefined
    return {
      ...error,
      ...(viaId ? { pcb_via_id: viaId } : {}),
      ...(via && typeof via.pcb_trace_id === "string"
        ? { pcb_trace_id: via.pcb_trace_id }
        : {}),
      ...(via && typeof via.x === "number" && typeof via.y === "number"
        ? { center: { x: via.x, y: via.y } }
        : {}),
    }
  }) as unknown as DrcErrorRecord[]
}

const getBoardPolygon = (srj: SimpleRouteJson): Point[] =>
  srj.outline && srj.outline.length >= 3
    ? srj.outline
    : [
        { x: srj.bounds.minX, y: srj.bounds.minY },
        { x: srj.bounds.maxX, y: srj.bounds.minY },
        { x: srj.bounds.maxX, y: srj.bounds.maxY },
        { x: srj.bounds.minX, y: srj.bounds.maxY },
      ]

const pointIsInsidePolygon = (point: Point, polygon: Point[]): boolean => {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    if (distanceToSegment(point, a, b) <= EPSILON) return true
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (crosses) inside = !inside
  }
  return inside
}

const distanceToPolygonEdge = (point: Point, polygon: Point[]): number =>
  Math.min(
    ...polygon.map((start, index) =>
      distanceToSegment(point, start, polygon[(index + 1) % polygon.length]!),
    ),
  )

const segmentToSegmentDistance = (
  aStart: Point,
  aEnd: Point,
  bStart: Point,
  bEnd: Point,
): number => {
  if (getSegmentIntersection(aStart, aEnd, bStart, bEnd)) return 0
  return Math.min(
    distanceToSegment(aStart, bStart, bEnd),
    distanceToSegment(aEnd, bStart, bEnd),
    distanceToSegment(bStart, aStart, aEnd),
    distanceToSegment(bEnd, aStart, aEnd),
  )
}

export const getTraceBoardEdgeErrors = ({
  traces,
  srj,
}: {
  traces: SimplifiedPcbTraces
  srj: SimpleRouteJson
}): DrcErrorRecord[] => {
  const polygon = getBoardPolygon(srj)
  const requiredEdgeClearance =
    srj.minBoardEdgeClearance ?? DEFAULT_BOARD_EDGE_CLEARANCE
  const errors: DrcErrorRecord[] = []
  for (const trace of traces) {
    for (
      let routeIndex = 0;
      routeIndex < trace.route.length - 1;
      routeIndex++
    ) {
      const point = trace.route[routeIndex]!
      const next = trace.route[routeIndex + 1]!
      if (
        point.route_type !== "wire" ||
        next.route_type !== "wire" ||
        point.layer !== next.layer
      )
        continue
      const centerlineEdgeDistance = Math.min(
        ...polygon.map((edgeStart, edgeIndex) =>
          segmentToSegmentDistance(
            point,
            next,
            edgeStart,
            polygon[(edgeIndex + 1) % polygon.length]!,
          ),
        ),
      )
      const segmentIsInside =
        pointIsInsidePolygon(point, polygon) &&
        pointIsInsidePolygon(next, polygon) &&
        centerlineEdgeDistance > EPSILON
      const actualClearance = segmentIsInside
        ? centerlineEdgeDistance - point.width / 2
        : -centerlineEdgeDistance - point.width / 2
      if (actualClearance + EPSILON >= requiredEdgeClearance) continue
      errors.push({
        type: "pcb_trace_board_edge_clearance_error",
        pcb_trace_board_edge_clearance_error_id: [
          "trace_board_edge",
          trace.pcb_trace_id,
          routeIndex,
          point.layer,
        ].join(":"),
        message: `Trace ${trace.pcb_trace_id} is ${actualClearance.toFixed(3)}mm from the board edge; required ${requiredEdgeClearance.toFixed(3)}mm`,
        pcb_trace_id: trace.pcb_trace_id,
        center: { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 },
        actual_clearance: actualClearance,
        minimum_clearance: requiredEdgeClearance,
      })
    }
  }
  return errors
}

export const getTraceGeometryRuleErrors = ({
  traces,
  srj,
}: {
  traces: SimplifiedPcbTraces
  srj: SimpleRouteJson
}): DrcErrorRecord[] => {
  const errors: DrcErrorRecord[] = []
  const viaDimensions = getViaDimensions(srj)
  const validLayers: Set<string> = new Set(
    Array.from({ length: srj.layerCount }, (_, z) =>
      mapZToLayerName(z, srj.layerCount),
    ),
  )
  const addError = ({
    trace,
    routeIndex,
    rule,
    message,
    center,
    actual,
    minimum,
  }: {
    trace: SimplifiedPcbTrace
    routeIndex: number
    rule: string
    message: string
    center?: Point
    actual?: number
    minimum?: number
  }): void => {
    errors.push({
      type: "pcb_trace_geometry_rule_error",
      pcb_trace_geometry_rule_error_id: [
        "trace_geometry",
        trace.pcb_trace_id,
        routeIndex,
        rule,
      ].join(":"),
      pcb_trace_id: trace.pcb_trace_id,
      message,
      ...(center ? { center } : {}),
      ...(actual !== undefined ? { actual_clearance: actual } : {}),
      ...(minimum !== undefined ? { minimum_clearance: minimum } : {}),
    })
  }
  for (const trace of traces) {
    for (let routeIndex = 0; routeIndex < trace.route.length; routeIndex++) {
      const point = trace.route[routeIndex]!
      const center =
        "x" in point &&
        "y" in point &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y)
          ? { x: point.x, y: point.y }
          : undefined
      if (
        ("x" in point && !Number.isFinite(point.x)) ||
        ("y" in point && !Number.isFinite(point.y))
      ) {
        addError({
          trace,
          routeIndex,
          rule: "finite_position",
          message: `Trace ${trace.pcb_trace_id} route point ${routeIndex} has a non-finite position`,
        })
        continue
      }
      if (point.route_type === "wire") {
        if (!Number.isFinite(point.width) || point.width <= 0) {
          addError({
            trace,
            routeIndex,
            rule: "finite_positive_wire_width",
            message: `Trace ${trace.pcb_trace_id} wire ${routeIndex} has invalid width ${point.width}`,
            center,
          })
        } else if (point.width + EPSILON < srj.minTraceWidth) {
          addError({
            trace,
            routeIndex,
            rule: "minimum_wire_width",
            message: `Trace ${trace.pcb_trace_id} wire ${routeIndex} is narrower than ${srj.minTraceWidth}mm`,
            center,
            actual: point.width,
            minimum: srj.minTraceWidth,
          })
        }
        if (!validLayers.has(point.layer)) {
          addError({
            trace,
            routeIndex,
            rule: "valid_wire_layer",
            message: `Trace ${trace.pcb_trace_id} wire ${routeIndex} uses invalid layer ${point.layer}`,
            center,
          })
        }
      }
      if (point.route_type === "via") {
        const padDiameter = point.via_diameter ?? viaDimensions.padDiameter
        const holeDiameter =
          point.via_hole_diameter ?? viaDimensions.holeDiameter
        if (!Number.isFinite(padDiameter) || padDiameter <= 0) {
          addError({
            trace,
            routeIndex,
            rule: "finite_positive_via_pad",
            message: `Trace ${trace.pcb_trace_id} via ${routeIndex} has invalid pad diameter ${padDiameter}`,
            center,
          })
        } else if (padDiameter + EPSILON < viaDimensions.padDiameter) {
          addError({
            trace,
            routeIndex,
            rule: "minimum_via_pad",
            message: `Trace ${trace.pcb_trace_id} via ${routeIndex} pad is smaller than ${viaDimensions.padDiameter}mm`,
            center,
            actual: padDiameter,
            minimum: viaDimensions.padDiameter,
          })
        }
        if (!Number.isFinite(holeDiameter) || holeDiameter <= 0) {
          addError({
            trace,
            routeIndex,
            rule: "finite_positive_via_hole",
            message: `Trace ${trace.pcb_trace_id} via ${routeIndex} has invalid hole diameter ${holeDiameter}`,
            center,
          })
        } else if (holeDiameter + EPSILON < viaDimensions.holeDiameter) {
          addError({
            trace,
            routeIndex,
            rule: "minimum_via_hole",
            message: `Trace ${trace.pcb_trace_id} via ${routeIndex} hole is smaller than ${viaDimensions.holeDiameter}mm`,
            center,
            actual: holeDiameter,
            minimum: viaDimensions.holeDiameter,
          })
        }
        if (
          Number.isFinite(padDiameter) &&
          Number.isFinite(holeDiameter) &&
          holeDiameter > padDiameter + EPSILON
        ) {
          addError({
            trace,
            routeIndex,
            rule: "via_hole_within_pad",
            message: `Trace ${trace.pcb_trace_id} via ${routeIndex} hole exceeds its pad diameter`,
            center,
            actual: padDiameter,
            minimum: holeDiameter,
          })
        }
        if (
          !validLayers.has(point.from_layer) ||
          !validLayers.has(point.to_layer)
        ) {
          addError({
            trace,
            routeIndex,
            rule: "valid_via_layers",
            message: `Trace ${trace.pcb_trace_id} via ${routeIndex} uses invalid layer span ${point.from_layer}-${point.to_layer}`,
            center,
          })
        }
      }
    }
  }
  return errors
}

export const getViaBoardEdgeErrors = ({
  traces,
  srj,
}: {
  traces: SimplifiedPcbTraces
  srj: SimpleRouteJson
}): DrcErrorRecord[] => {
  const polygon = getBoardPolygon(srj)
  const defaultViaDiameter = getViaDimensions(srj).padDiameter
  const requiredEdgeClearance =
    srj.minBoardEdgeClearance ?? DEFAULT_BOARD_EDGE_CLEARANCE
  const errors: DrcErrorRecord[] = []
  for (const trace of traces) {
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      const viaRadius = (point.via_diameter ?? defaultViaDiameter) / 2
      const centerToEdge = distanceToPolygonEdge(point, polygon)
      const actualClearance = pointIsInsidePolygon(point, polygon)
        ? centerToEdge - viaRadius
        : -centerToEdge - viaRadius
      if (actualClearance + EPSILON >= requiredEdgeClearance) continue
      errors.push({
        type: "pcb_via_board_edge_clearance_error",
        pcb_via_board_edge_clearance_error_id: [
          "via_board_edge",
          trace.pcb_trace_id,
          point.x.toFixed(6),
          point.y.toFixed(6),
          point.from_layer,
          point.to_layer,
        ].join(":"),
        message: `Via annulus is ${actualClearance.toFixed(3)}mm from the board edge; required ${requiredEdgeClearance.toFixed(3)}mm`,
        pcb_trace_id: trace.pcb_trace_id,
        center: { x: point.x, y: point.y },
        actual_clearance: actualClearance,
        minimum_clearance: requiredEdgeClearance,
      })
    }
  }
  return errors
}

const rotatePointAround = (
  point: Point,
  center: Point,
  degrees: number,
): Point => {
  const radians = (degrees * Math.PI) / 180
  const dx = point.x - center.x
  const dy = point.y - center.y
  return {
    x: dx * Math.cos(radians) - dy * Math.sin(radians),
    y: dx * Math.sin(radians) + dy * Math.cos(radians),
  }
}

const getObstaclePolygon = (
  obstacle: SimpleRouteJson["obstacles"][number],
): Point[] => {
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map((point) => ({
    x: obstacle.center.x + point.x * cos - point.y * sin,
    y: obstacle.center.y + point.x * sin + point.y * cos,
  }))
}

export const getSrjConnectedObstacleBoardEdgeErrors = ({
  srj,
}: {
  srj: SimpleRouteJson
}): DrcErrorRecord[] => {
  const boardPolygon = getBoardPolygon(srj)
  const requiredEdgeClearance =
    srj.minBoardEdgeClearance ?? DEFAULT_BOARD_EDGE_CLEARANCE
  const errors: DrcErrorRecord[] = []
  for (
    let obstacleIndex = 0;
    obstacleIndex < srj.obstacles.length;
    obstacleIndex++
  ) {
    const obstacle = srj.obstacles[obstacleIndex]!
    if (obstacle.isCopperPour || obstacle.connectedTo.length === 0) continue
    let actualClearance: number
    if (obstacleIsCircular(obstacle)) {
      const centerToEdge = distanceToPolygonEdge(obstacle.center, boardPolygon)
      actualClearance = pointIsInsidePolygon(obstacle.center, boardPolygon)
        ? centerToEdge - obstacle.width / 2
        : -centerToEdge - obstacle.width / 2
    } else if (obstacleIsOval(obstacle)) {
      const obstacleToEdgeDistance = Math.min(
        ...boardPolygon.map((boardStart, boardEdgeIndex) =>
          segmentToEllipseDistance(
            boardStart,
            boardPolygon[(boardEdgeIndex + 1) % boardPolygon.length]!,
            obstacle,
          ),
        ),
      )
      const obstacleIsInside =
        pointIsInsidePolygon(obstacle.center, boardPolygon) &&
        obstacleToEdgeDistance > EPSILON
      actualClearance = obstacleIsInside
        ? obstacleToEdgeDistance
        : -obstacleToEdgeDistance
    } else {
      const obstaclePolygon = getObstaclePolygon(obstacle)
      const centerlineEdgeDistance = Math.min(
        ...obstaclePolygon.flatMap((obstacleStart, obstacleEdgeIndex) =>
          boardPolygon.map((boardStart, boardEdgeIndex) =>
            segmentToSegmentDistance(
              obstacleStart,
              obstaclePolygon[
                (obstacleEdgeIndex + 1) % obstaclePolygon.length
              ]!,
              boardStart,
              boardPolygon[(boardEdgeIndex + 1) % boardPolygon.length]!,
            ),
          ),
        ),
      )
      const obstacleIsInside = obstaclePolygon.every((point) =>
        pointIsInsidePolygon(point, boardPolygon),
      )
      actualClearance = obstacleIsInside
        ? centerlineEdgeDistance
        : -centerlineEdgeDistance
    }
    if (actualClearance + EPSILON >= requiredEdgeClearance) continue
    errors.push({
      type: "pcb_fixed_copper_board_edge_clearance_error",
      pcb_fixed_copper_board_edge_clearance_error_id: [
        "fixed_copper_board_edge",
        obstacle.obstacleId ?? obstacleIndex,
      ].join(":"),
      message: `Fixed connected obstacle ${obstacle.obstacleId ?? obstacleIndex} is ${actualClearance.toFixed(3)}mm from the board edge; required ${requiredEdgeClearance.toFixed(3)}mm`,
      center: obstacle.center,
      actual_clearance: actualClearance,
      minimum_clearance: requiredEdgeClearance,
    })
  }
  return errors
}

const pointToObstacleDistance = (
  point: Point,
  obstacle: SimpleRouteJson["obstacles"][number],
): number => {
  if (obstacleIsCircular(obstacle)) {
    return Math.max(
      0,
      Math.hypot(point.x - obstacle.center.x, point.y - obstacle.center.y) -
        obstacle.width / 2,
    )
  }
  if (obstacleIsOval(obstacle)) {
    return pointToEllipseDistance(point, obstacle)
  }
  const local = rotatePointAround(
    point,
    obstacle.center,
    -(obstacle.ccwRotationDegrees ?? 0),
  )
  const outsideX = Math.max(Math.abs(local.x) - obstacle.width / 2, 0)
  const outsideY = Math.max(Math.abs(local.y) - obstacle.height / 2, 0)
  return Math.hypot(outsideX, outsideY)
}

const segmentToObstacleDistance = (
  start: Point,
  end: Point,
  obstacle: SimpleRouteJson["obstacles"][number],
): number => {
  if (obstacleIsCircular(obstacle)) {
    return Math.max(
      0,
      distanceToSegment(obstacle.center, start, end) - obstacle.width / 2,
    )
  }
  if (obstacleIsOval(obstacle)) {
    return segmentToEllipseDistance(start, end, obstacle)
  }
  const angle = -(obstacle.ccwRotationDegrees ?? 0)
  const localStart = rotatePointAround(start, obstacle.center, angle)
  const localEnd = rotatePointAround(end, obstacle.center, angle)
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  const isInside = (point: Point): boolean =>
    Math.abs(point.x) <= halfWidth + EPSILON &&
    Math.abs(point.y) <= halfHeight + EPSILON
  if (isInside(localStart) || isInside(localEnd)) return 0
  const corners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]
  return Math.min(
    ...corners.map((corner, index) =>
      segmentToSegmentDistance(
        localStart,
        localEnd,
        corner,
        corners[(index + 1) % corners.length]!,
      ),
    ),
  )
}

const traceTouchesObstacleCopper = ({
  trace,
  obstacle,
  layerCount,
  defaultViaDiameter,
}: {
  trace: SimplifiedPcbTrace
  obstacle: SimpleRouteJson["obstacles"][number]
  layerCount: number
  defaultViaDiameter: number
}): boolean => {
  for (const segment of getTraceWireSegments(trace)) {
    if (
      obstacle.layers.includes(segment.layer) &&
      segmentToObstacleDistance(segment.start, segment.end, obstacle) <=
        segment.width / 2 + EPSILON
    )
      return true
  }
  return trace.route.some(
    (point) =>
      point.route_type === "via" &&
      getViaLayers(point, layerCount).some((layer) =>
        obstacle.layers.includes(layer),
      ) &&
      pointToObstacleDistance(point, obstacle) <=
        (point.via_diameter ?? defaultViaDiameter) / 2 + EPSILON,
  )
}

const traceIsConnectedToObstacle = ({
  trace,
  obstacle,
  connectivityMap,
}: {
  trace: SimplifiedPcbTrace
  obstacle: SimpleRouteJson["obstacles"][number]
  connectivityMap: ConnectivityMap
}): boolean => {
  const traceIds = [
    trace.pcb_trace_id,
    trace.connection_name,
    ...(trace.connectsTo ?? []),
  ]
  return traceIds.some((traceId) =>
    obstacle.connectedTo.some(
      (obstacleId) =>
        traceId === obstacleId ||
        connectivityMap.areIdsConnected(traceId, obstacleId),
    ),
  )
}

const getSameNetViaObstacleContainmentGuardErrors = ({
  traces,
  srj,
  connectivityMap,
}: {
  traces: SimplifiedPcbTraces
  srj: SimpleRouteJson
  connectivityMap: ConnectivityMap
}): DrcErrorRecord[] => {
  if (srj.allowViaInPad) return []
  const errors: DrcErrorRecord[] = []
  for (const trace of traces) {
    for (let routeIndex = 0; routeIndex < trace.route.length; routeIndex++) {
      const point = trace.route[routeIndex]!
      if (point.route_type !== "via") continue
      const layers = getViaLayers(point, srj.layerCount)
      for (
        let obstacleIndex = 0;
        obstacleIndex < srj.obstacles.length;
        obstacleIndex++
      ) {
        const obstacle = srj.obstacles[obstacleIndex]!
        if (
          obstacle.isCopperPour ||
          !traceIsConnectedToObstacle({ trace, obstacle, connectivityMap }) ||
          !layers.some((layer) => obstacle.layers.includes(layer)) ||
          pointToObstacleDistance(point, obstacle) > EPSILON
        )
          continue
        const obstacleId = obstacle.obstacleId ?? `obstacle_${obstacleIndex}`
        errors.push({
          type: "pcb_via_same_net_obstacle_containment_guard_error",
          pcb_via_same_net_obstacle_containment_guard_error_id: [
            "same_net_via_obstacle",
            trace.pcb_trace_id,
            routeIndex,
            obstacleId,
          ].join(":"),
          pcb_trace_id: trace.pcb_trace_id,
          center: { x: point.x, y: point.y },
          message: `Via on ${trace.pcb_trace_id} is inside same-net obstacle ${obstacleId}`,
        })
      }
    }
  }
  return errors
}

const getJumperPadClearanceGuardErrors = ({
  traces,
  srj,
  connectivityMap,
}: {
  traces: SimplifiedPcbTraces
  srj: SimpleRouteJson
  connectivityMap: ConnectivityMap
}): DrcErrorRecord[] => {
  const errors: DrcErrorRecord[] = []
  const requiredWireClearance = Math.max(
    srj.defaultObstacleMargin ?? 0,
    srj.minTraceToPadEdgeClearance ?? 0.1,
  )
  const requiredViaClearance = Math.max(
    srj.defaultObstacleMargin ?? 0,
    srj.minViaEdgeToPadEdgeClearance ?? 0.1,
  )
  const defaultViaDiameter = getViaDimensions(srj).padDiameter
  for (const jumperTrace of traces) {
    for (
      let jumperRouteIndex = 0;
      jumperRouteIndex < jumperTrace.route.length;
      jumperRouteIndex++
    ) {
      const jumper = jumperTrace.route[jumperRouteIndex]!
      if (jumper.route_type !== "jumper") continue
      const dimensions = JUMPER_DIMENSIONS[jumper.footprint]
      const rotation =
        (Math.atan2(
          jumper.end.y - jumper.start.y,
          jumper.end.x - jumper.start.x,
        ) *
          180) /
        Math.PI
      for (const [padName, center] of [
        ["start", jumper.start],
        ["end", jumper.end],
      ] as const) {
        const padObstacle: SimpleRouteJson["obstacles"][number] = {
          type: "rect",
          layers: [jumper.layer],
          center,
          width: dimensions.padLength,
          height: dimensions.padWidth,
          ccwRotationDegrees: rotation,
          connectedTo: [
            jumperTrace.pcb_trace_id,
            jumperTrace.connection_name,
            ...(jumperTrace.connectsTo ?? []),
          ],
        }
        for (const trace of traces) {
          if (
            trace === jumperTrace ||
            traceIsConnectedToObstacle({
              trace,
              obstacle: padObstacle,
              connectivityMap,
            })
          )
            continue
          for (
            let routeIndex = 0;
            routeIndex < trace.route.length;
            routeIndex++
          ) {
            const point = trace.route[routeIndex]!
            const next = trace.route[routeIndex + 1]
            if (
              point.route_type === "wire" &&
              next?.route_type === "wire" &&
              point.layer === jumper.layer &&
              next.layer === jumper.layer
            ) {
              const clearance =
                segmentToObstacleDistance(point, next, padObstacle) -
                point.width / 2
              if (clearance + EPSILON < requiredWireClearance) {
                errors.push({
                  type: "pcb_jumper_pad_trace_clearance_guard_error",
                  pcb_jumper_pad_trace_clearance_guard_error_id: [
                    "jumper_pad_trace",
                    jumperTrace.pcb_trace_id,
                    jumperRouteIndex,
                    padName,
                    trace.pcb_trace_id,
                    routeIndex,
                  ].join(":"),
                  pcb_trace_id: trace.pcb_trace_id,
                  center: pointToSegmentClosestPoint(center, point, next),
                  minimum_clearance: requiredWireClearance,
                  actual_clearance: clearance,
                  message: `Trace ${trace.pcb_trace_id} is too close to ${padName} pad of jumper ${jumperTrace.pcb_trace_id}`,
                })
              }
            }
            if (
              point.route_type === "via" &&
              getViaLayers(point, srj.layerCount).includes(jumper.layer)
            ) {
              const clearance =
                pointToObstacleDistance(point, padObstacle) -
                (point.via_diameter ?? defaultViaDiameter) / 2
              if (clearance + EPSILON < requiredViaClearance) {
                errors.push({
                  type: "pcb_jumper_pad_via_clearance_guard_error",
                  pcb_jumper_pad_via_clearance_guard_error_id: [
                    "jumper_pad_via",
                    jumperTrace.pcb_trace_id,
                    jumperRouteIndex,
                    padName,
                    trace.pcb_trace_id,
                    routeIndex,
                  ].join(":"),
                  pcb_trace_id: trace.pcb_trace_id,
                  center: { x: point.x, y: point.y },
                  minimum_clearance: requiredViaClearance,
                  actual_clearance: clearance,
                  message: `Via on ${trace.pcb_trace_id} is too close to ${padName} pad of jumper ${jumperTrace.pcb_trace_id}`,
                })
              }
            }
          }
        }
      }
    }
  }
  return errors
}

/** Validate every fixed non-pour SRJ obstacle against mutable copper. */
export const getSrjObstacleClearanceErrors = ({
  traces,
  srj,
  connectivityMap,
}: {
  traces: SimplifiedPcbTraces
  srj: SimpleRouteJson
  connectivityMap: ConnectivityMap
}): DrcErrorRecord[] => {
  const errors: DrcErrorRecord[] = []
  const requiredWireClearance = Math.max(
    srj.defaultObstacleMargin ?? 0,
    srj.minTraceToPadEdgeClearance ?? 0.1,
  )
  const requiredViaClearance = Math.max(
    srj.defaultObstacleMargin ?? 0,
    srj.minViaEdgeToPadEdgeClearance ?? 0.1,
  )
  const defaultViaDiameter = getViaDimensions(srj).padDiameter
  const terminalObstacleIndices = new Set(
    srj.obstacles.flatMap((obstacle, obstacleIndex) =>
      obstacleRepresentsAuthoritativeRoutingPad(obstacle, srj)
        ? [obstacleIndex]
        : [],
    ),
  )
  const obstacleEntries = srj.obstacles.flatMap((obstacle, obstacleIndex) =>
    obstacle.isCopperPour
      ? []
      : [
          {
            obstacle,
            obstacleIndex,
            bounds: getObstacleAxisAlignedBounds(obstacle),
          },
        ],
  )
  for (const trace of traces) {
    // These records explicitly encode intentional obstacle traversal and are
    // immutable in this repair stage.
    if (
      trace.route.some(
        (point) =>
          point.route_type === "through_obstacle" ||
          point.route_type === "jumper",
      )
    )
      continue
    const copperPoints = trace.route.flatMap((point) =>
      point.route_type === "wire" || point.route_type === "via" ? [point] : [],
    )
    if (copperPoints.length === 0) continue
    const maximumCopperRadius = trace.route.reduce((maximum, point) => {
      if (point.route_type === "wire") return Math.max(maximum, point.width / 2)
      if (point.route_type === "via")
        return Math.max(maximum, (point.via_diameter ?? defaultViaDiameter) / 2)
      return maximum
    }, 0)
    const boundsMargin =
      Math.max(requiredWireClearance, requiredViaClearance) +
      maximumCopperRadius
    const traceBounds: AxisAlignedBounds = {
      minX: Math.min(...copperPoints.map((point) => point.x)) - boundsMargin,
      maxX: Math.max(...copperPoints.map((point) => point.x)) + boundsMargin,
      minY: Math.min(...copperPoints.map((point) => point.y)) - boundsMargin,
      maxY: Math.max(...copperPoints.map((point) => point.y)) + boundsMargin,
    }
    for (const { obstacle, obstacleIndex, bounds } of obstacleEntries) {
      if (
        traceBounds.maxX < bounds.minX ||
        traceBounds.minX > bounds.maxX ||
        traceBounds.maxY < bounds.minY ||
        traceBounds.minY > bounds.maxY ||
        traceIsConnectedToObstacle({ trace, obstacle, connectivityMap })
      )
        continue
      const isTerminalPad = terminalObstacleIndices.has(obstacleIndex)
      for (let routeIndex = 0; routeIndex < trace.route.length; routeIndex++) {
        const point = trace.route[routeIndex]!
        const next = trace.route[routeIndex + 1]
        if (
          point.route_type === "wire" &&
          next?.route_type === "wire" &&
          point.layer === next.layer &&
          obstacle.layers.includes(point.layer)
        ) {
          const actualClearance =
            segmentToObstacleDistance(point, next, obstacle) - point.width / 2
          if (actualClearance + EPSILON < requiredWireClearance) {
            const movableEndpoints = [
              ...(routeIndex > 0 ? [point] : []),
              ...(routeIndex + 1 < trace.route.length - 1 ? [next] : []),
            ]
            const repairCenter = movableEndpoints.sort(
              (a, b) =>
                Math.hypot(a.x - obstacle.center.x, a.y - obstacle.center.y) -
                Math.hypot(b.x - obstacle.center.x, b.y - obstacle.center.y),
            )[0] ?? {
              x: (point.x + next.x) / 2,
              y: (point.y + next.y) / 2,
            }
            errors.push({
              type: "pcb_trace_srj_obstacle_clearance_error",
              pcb_trace_srj_obstacle_clearance_error_id: [
                "trace_obstacle",
                trace.pcb_trace_id,
                obstacle.obstacleId ?? obstacleIndex,
                routeIndex,
              ].join(":"),
              pcb_trace_id: trace.pcb_trace_id,
              center: { x: repairCenter.x, y: repairCenter.y },
              actual_clearance: actualClearance,
              minimum_clearance: requiredWireClearance,
              is_terminal_pad_clearance: isTerminalPad,
              srj_obstacle_index: obstacleIndex,
              message: `Trace ${trace.pcb_trace_id} is too close to SRJ obstacle ${obstacle.obstacleId ?? obstacleIndex}`,
            })
          }
        }
        if (
          point.route_type === "via" &&
          getViaLayers(point, srj.layerCount).some((layer) =>
            obstacle.layers.includes(layer),
          )
        ) {
          const viaRadius = (point.via_diameter ?? defaultViaDiameter) / 2
          const actualClearance =
            pointToObstacleDistance(point, obstacle) - viaRadius
          if (actualClearance + EPSILON < requiredViaClearance) {
            errors.push({
              type: "pcb_via_srj_obstacle_clearance_error",
              pcb_via_srj_obstacle_clearance_error_id: [
                "via_obstacle",
                trace.pcb_trace_id,
                obstacle.obstacleId ?? obstacleIndex,
                routeIndex,
              ].join(":"),
              pcb_trace_id: trace.pcb_trace_id,
              center: { x: point.x, y: point.y },
              actual_clearance: actualClearance,
              minimum_clearance: requiredViaClearance,
              is_terminal_pad_clearance: isTerminalPad,
              srj_obstacle_index: obstacleIndex,
              message: `Via on ${trace.pcb_trace_id} is too close to SRJ obstacle ${obstacle.obstacleId ?? obstacleIndex}`,
            })
          }
        }
      }
    }
  }
  return errors
}

const replaceTrace = (
  traces: SimplifiedPcbTraces,
  replacement: SimplifiedPcbTrace,
): SimplifiedPcbTraces =>
  traces.map((trace) =>
    trace.pcb_trace_id === replacement.pcb_trace_id ? replacement : trace,
  )

const findViaIndex = (
  trace: SimplifiedPcbTrace,
  viaRecord: { x: number; y: number; layers?: string[] },
): number =>
  trace.route.findIndex(
    (point) =>
      point.route_type === "via" &&
      pointsEqual(point, viaRecord) &&
      (!viaRecord.layers ||
        (viaRecord.layers.includes(point.from_layer) &&
          viaRecord.layers.includes(point.to_layer))),
  )

export const relocateViaVertex = (
  trace: SimplifiedPcbTrace,
  viaIndex: number,
  offset: { dx: number; dy: number },
): SimplifiedPcbTrace | null => {
  const route = structuredClone(trace.route)
  const via = route[viaIndex]
  if (via?.route_type !== "via") return null
  for (const index of [viaIndex - 1, viaIndex, viaIndex + 1]) {
    const point = route[index]
    if (point?.route_type !== "wire" && point?.route_type !== "via") return null
    route[index] = copyRoutePointAt(point, {
      x: point.x + offset.dx,
      y: point.y + offset.dy,
    })
  }
  return { ...trace, route }
}

const getTraceParticipants = (
  error: DrcErrorRecord,
  traces: SimplifiedPcbTraces,
): SimplifiedPcbTraces => {
  const portIds = new Set(error.pcb_port_ids ?? [])
  const primary =
    typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined
  const otherParticipants = traces.filter((trace) => {
    if (trace.pcb_trace_id === primary || !trace.connectsTo?.length)
      return false
    const connectedPorts = trace.connectsTo.filter((id) => portIds.has(id))
    return connectedPorts.length >= 2
  })
  const primaryTrace = primary
    ? traces.find((trace) => trace.pcb_trace_id === primary)
    : undefined
  return [...otherParticipants, ...(primaryTrace ? [primaryTrace] : [])]
}

const drcErrorInvolvesAnyTrace = ({
  error,
  traces,
  circuitJson,
  traceIds,
}: {
  error: DrcErrorRecord
  traces: SimplifiedPcbTraces
  circuitJson: AnyCircuitElement[]
  traceIds: ReadonlySet<string>
}): boolean => {
  if (
    typeof error.pcb_trace_id === "string" &&
    traceIds.has(error.pcb_trace_id)
  )
    return true
  if (
    getTraceParticipants(error, traces).some((trace) =>
      traceIds.has(trace.pcb_trace_id),
    )
  )
    return true

  const viaIds = new Set<string>()
  if (typeof error.pcb_via_id === "string") viaIds.add(error.pcb_via_id)
  if (Array.isArray(error.pcb_via_ids)) {
    for (const viaId of error.pcb_via_ids) {
      if (typeof viaId === "string") viaIds.add(viaId)
    }
  }
  if (
    circuitJson.some(
      (element) =>
        element.type === "pcb_via" &&
        viaIds.has(element.pcb_via_id) &&
        typeof element.pcb_trace_id === "string" &&
        traceIds.has(element.pcb_trace_id),
    )
  )
    return true

  const identity = getDrcErrorIdentity(error)
  for (const traceId of traceIds) {
    for (const otherTrace of traces) {
      if (
        identity === `overlap_${traceId}_${otherTrace.pcb_trace_id}` ||
        identity === `overlap_${otherTrace.pcb_trace_id}_${traceId}`
      )
        return true
    }
  }
  return false
}

const traceBelongsToConnection = ({
  trace,
  connectionName,
  connectivityMap,
}: {
  trace: SimplifiedPcbTrace
  connectionName: string
  connectivityMap: ConnectivityMap
}): boolean =>
  trace.connection_name === connectionName ||
  trace.connectsTo?.includes(connectionName) === true ||
  connectivityMap.areIdsConnected(trace.connection_name, connectionName)

const isTraceDifferentialPairMember = ({
  trace,
  srj,
  connectivityMap,
}: {
  trace: SimplifiedPcbTrace
  srj: SimpleRouteJson
  connectivityMap: ConnectivityMap
}): boolean =>
  (srj.differentialPairs ?? []).some((pair) =>
    pair.connectionNames.some((connectionName) =>
      traceBelongsToConnection({ trace, connectionName, connectivityMap }),
    ),
  )

const isTraceMaxLengthSkewBusMember = ({
  trace,
  srj,
  connectivityMap,
}: {
  trace: SimplifiedPcbTrace
  srj: SimpleRouteJson
  connectivityMap: ConnectivityMap
}): boolean =>
  (srj.buses ?? []).some(
    (bus) =>
      typeof bus.maxLengthSkew === "number" &&
      bus.connectionNames.some((connectionName) =>
        traceBelongsToConnection({ trace, connectionName, connectivityMap }),
      ),
  )

export const isTraceMutationAllowedByRoutingPolicy = ({
  trace,
  srj,
  connectivityMap,
}: {
  trace: SimplifiedPcbTrace
  srj: SimpleRouteJson
  connectivityMap: ConnectivityMap
}): boolean =>
  !trace.route.some(
    (point) =>
      point.route_type === "jumper" || point.route_type === "through_obstacle",
  ) &&
  !isTraceDifferentialPairMember({ trace, srj, connectivityMap }) &&
  !isTraceMaxLengthSkewBusMember({ trace, srj, connectivityMap })

export const getPolicyAllowedLiftLayers = ({
  trace,
  srj,
  connectivityMap,
}: {
  trace: SimplifiedPcbTrace
  srj: SimpleRouteJson
  connectivityMap: ConnectivityMap
}): string[] => {
  const isDifferentialPairMember = isTraceDifferentialPairMember({
    trace,
    srj,
    connectivityMap,
  })
  const isLengthMatchedBusMember = isTraceMaxLengthSkewBusMember({
    trace,
    srj,
    connectivityMap,
  })
  if (isDifferentialPairMember || isLengthMatchedBusMember) return []

  const busLayerRestrictions = (srj.buses ?? []).flatMap((bus) =>
    bus.allowedLayers &&
    bus.connectionNames.some((connectionName) =>
      traceBelongsToConnection({ trace, connectionName, connectivityMap }),
    )
      ? [new Set(bus.allowedLayers)]
      : [],
  )
  return Array.from({ length: srj.layerCount }, (_, z) =>
    mapZToLayerName(z, srj.layerCount),
  ).filter((layer) =>
    busLayerRestrictions.every((allowedLayers) => allowedLayers.has(layer)),
  )
}

const getViaLayers = (via: ViaPoint, layerCount: number): string[] => {
  const fromZ = mapLayerNameToZ(via.from_layer, layerCount)
  const toZ = mapLayerNameToZ(via.to_layer, layerCount)
  return Array.from({ length: Math.abs(toZ - fromZ) + 1 }, (_, offset) =>
    mapZToLayerName(Math.min(fromZ, toZ) + offset, layerCount),
  )
}

const getTraceWireSegments = (trace: SimplifiedPcbTrace): WireSegment[] =>
  trace.route.slice(0, -1).flatMap((point, index) => {
    const next = trace.route[index + 1]
    return point.route_type === "wire" &&
      next?.route_type === "wire" &&
      point.layer === next.layer
      ? [{ start: point, end: next, layer: point.layer, width: point.width }]
      : []
  })

const getTraceCopperCapsules = (
  trace: SimplifiedPcbTrace,
  layerCount: number,
  defaultViaDiameter: number,
): CopperCapsule[] => [
  ...getTraceWireSegments(trace).map((segment) => ({
    start: segment.start,
    end: segment.end,
    layer: segment.layer,
    radius: segment.width / 2,
  })),
  ...trace.route.flatMap((point) => {
    if (point.route_type === "via")
      return getViaLayers(point, layerCount).map((layer) => ({
        start: point,
        end: point,
        layer,
        radius: (point.via_diameter ?? defaultViaDiameter) / 2,
      }))
    return []
  }),
]

type ClosestCenterlinePair = {
  onFirst: Point
  onSecond: Point
  distance: number
}

const getClosestCenterlinePair = (
  first: CopperCapsule,
  second: CopperCapsule,
): ClosestCenterlinePair => {
  const intersection = getSegmentIntersection(
    first.start,
    first.end,
    second.start,
    second.end,
  )
  if (intersection)
    return { onFirst: intersection, onSecond: intersection, distance: 0 }
  const candidates = [
    {
      onFirst: first.start,
      onSecond: pointToSegmentClosestPoint(
        first.start,
        second.start,
        second.end,
      ),
    },
    {
      onFirst: first.end,
      onSecond: pointToSegmentClosestPoint(first.end, second.start, second.end),
    },
    {
      onFirst: pointToSegmentClosestPoint(second.start, first.start, first.end),
      onSecond: second.start,
    },
    {
      onFirst: pointToSegmentClosestPoint(second.end, first.start, first.end),
      onSecond: second.end,
    },
  ].map((candidate) => ({
    ...candidate,
    distance: Math.hypot(
      candidate.onFirst.x - candidate.onSecond.x,
      candidate.onFirst.y - candidate.onSecond.y,
    ),
  }))
  return candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
      a.onFirst.x - b.onFirst.x ||
      a.onFirst.y - b.onFirst.y ||
      a.onSecond.x - b.onSecond.x ||
      a.onSecond.y - b.onSecond.y,
  )[0]!
}

const getCopperContactWitness = (
  first: CopperCapsule,
  second: CopperCapsule,
): LayerPoint | null => {
  if (first.layer !== second.layer) return null
  const closest = getClosestCenterlinePair(first, second)
  if (closest.distance > first.radius + second.radius + EPSILON) return null
  if (closest.distance <= EPSILON)
    return { ...closest.onFirst, layer: first.layer }
  const low = Math.max(0, closest.distance - second.radius)
  const high = Math.min(closest.distance, first.radius)
  if (low > high + EPSILON) return null
  const distanceFromFirst = (low + high) / 2
  const ratio = distanceFromFirst / closest.distance
  return {
    x: closest.onFirst.x + (closest.onSecond.x - closest.onFirst.x) * ratio,
    y: closest.onFirst.y + (closest.onSecond.y - closest.onFirst.y) * ratio,
    layer: first.layer,
  }
}

const traceHasCopperAt = (
  trace: SimplifiedPcbTrace,
  junction: LayerPoint,
  layerCount: number,
  defaultViaDiameter: number,
): boolean => {
  return getTraceCopperCapsules(trace, layerCount, defaultViaDiameter).some(
    (capsule) =>
      capsule.layer === junction.layer &&
      distanceToSegment(junction, capsule.start, capsule.end) <=
        capsule.radius + EPSILON,
  )
}

const getRequiredSameNetJunctions = ({
  trace,
  otherTraces,
  connectivityMap,
  layerCount,
  defaultViaDiameter,
}: {
  trace: SimplifiedPcbTrace
  otherTraces: SimplifiedPcbTraces
  connectivityMap: ConnectivityMap
  layerCount: number
  defaultViaDiameter: number
}): LayerPoint[] => {
  const junctionsByKey = new Map<string, LayerPoint>()
  const addJunction = (point: LayerPoint): void => {
    junctionsByKey.set(
      `${point.x.toFixed(6)}:${point.y.toFixed(6)}:${point.layer}`,
      point,
    )
  }
  const traceCopper = getTraceCopperCapsules(
    trace,
    layerCount,
    defaultViaDiameter,
  )
  for (const other of otherTraces) {
    const sameNet =
      trace.connection_name === other.connection_name ||
      connectivityMap.areIdsConnected(
        trace.connection_name,
        other.connection_name,
      )
    if (!sameNet) continue
    const otherCopper = getTraceCopperCapsules(
      other,
      layerCount,
      defaultViaDiameter,
    )
    for (const tracePrimitive of traceCopper) {
      for (const otherPrimitive of otherCopper) {
        const witness = getCopperContactWitness(tracePrimitive, otherPrimitive)
        if (witness) addJunction(witness)
      }
    }
  }
  return [...junctionsByKey.values()]
}

export const hasPreservedSameNetJunctions = ({
  before,
  candidate,
  otherTraces,
  connectivityMap,
  layerCount,
  defaultViaDiameter = 0.6,
}: {
  before: SimplifiedPcbTrace
  candidate: SimplifiedPcbTrace
  otherTraces: SimplifiedPcbTraces
  connectivityMap: ConnectivityMap
  layerCount: number
  defaultViaDiameter?: number
}): boolean =>
  getRequiredSameNetJunctions({
    trace: before,
    otherTraces,
    connectivityMap,
    layerCount,
    defaultViaDiameter,
  }).every((junction) =>
    traceHasCopperAt(candidate, junction, layerCount, defaultViaDiameter),
  )

export const hasPreservedConnectionPointContacts = ({
  before,
  candidate,
  srj,
  connectivityMap,
  defaultViaDiameter = 0.6,
}: {
  before: SimplifiedPcbTrace
  candidate: SimplifiedPcbTrace
  srj: SimpleRouteJson
  connectivityMap: ConnectivityMap
  defaultViaDiameter?: number
}): boolean =>
  srj.connections.every(
    (connection) =>
      !traceBelongsToConnection({
        trace: before,
        connectionName: connection.name,
        connectivityMap,
      }) ||
      connection.pointsToConnect.every((point) => {
        const layers = "layer" in point ? [point.layer] : point.layers
        const baselineTouchesTerminal = layers.some((layer) =>
          traceHasCopperAt(
            before,
            { x: point.x, y: point.y, layer },
            srj.layerCount,
            defaultViaDiameter,
          ),
        )
        return (
          !baselineTouchesTerminal ||
          layers.some((layer) =>
            traceHasCopperAt(
              candidate,
              { x: point.x, y: point.y, layer },
              srj.layerCount,
              defaultViaDiameter,
            ),
          )
        )
      }),
  )

const createEvaluationFixedPreloadedTraces = ({
  preloadedTraces,
  routedTraces,
  reservedIdentifiers,
  physicalLogicalCollisionIds,
}: {
  preloadedTraces: SimplifiedPcbTraces
  routedTraces: SimplifiedPcbTraces
  reservedIdentifiers: ReadonlySet<string>
  physicalLogicalCollisionIds: ReadonlySet<string>
}): {
  traces: SimplifiedPcbTraces
  inputValidationError?: string
} => {
  const validationErrors: string[] = []
  if (physicalLogicalCollisionIds.size > 0) {
    validationErrors.push(
      `Post-power DRC cannot disambiguate physical trace identifier(s) used by foreign logical nets: ${[...physicalLogicalCollisionIds].sort().join(", ")}`,
    )
  }
  const replacedIds = new Set(
    routedTraces.flatMap((trace) =>
      trace.__replaces_pcb_trace_id ? [trace.__replaces_pcb_trace_id] : [],
    ),
  )
  const mutableIdCounts = new Map<string, number>()
  for (const trace of routedTraces) {
    mutableIdCounts.set(
      trace.pcb_trace_id,
      (mutableIdCounts.get(trace.pcb_trace_id) ?? 0) + 1,
    )
  }
  const duplicateMutableIds = [...mutableIdCounts]
    .filter(([, count]) => count > 1)
    .map(([traceId]) => traceId)
  if (duplicateMutableIds.length > 0) {
    validationErrors.push(
      `Post-power DRC cannot map multiple mutable traces with pcb_trace_id value(s): ${duplicateMutableIds.join(", ")}`,
    )
  }
  const activePreloadedTraces = preloadedTraces.filter(
    (trace) => !replacedIds.has(trace.pcb_trace_id),
  )
  const usedPhysicalIds = new Set(
    routedTraces.map((trace) => trace.pcb_trace_id),
  )
  const unavailableEvaluationIds = new Set(reservedIdentifiers)
  const traces = activePreloadedTraces.map((trace, index) => {
    let evaluationId = trace.pcb_trace_id
    if (usedPhysicalIds.has(evaluationId)) {
      let suffix = 0
      do {
        evaluationId = `__post_power_fixed_${index}_${suffix}`
        suffix++
      } while (
        usedPhysicalIds.has(evaluationId) ||
        unavailableEvaluationIds.has(evaluationId)
      )
    }
    usedPhysicalIds.add(evaluationId)
    unavailableEvaluationIds.add(evaluationId)
    return evaluationId === trace.pcb_trace_id
      ? trace
      : {
          ...trace,
          pcb_trace_id: evaluationId,
          // The global physical/logical collision validation above proves
          // these aliases either do not collide or belong to the same net.
          // Keep them so a renamed fixed copy remains connected to its
          // declared net while only its evaluation-only physical ID changes.
        }
  })
  return {
    traces,
    ...(validationErrors.length > 0
      ? { inputValidationError: validationErrors.join("; ") }
      : {}),
  }
}

const collectStringIdentifiers = (
  value: unknown,
  identifiers: Set<string>,
  visited: WeakSet<object> = new WeakSet(),
): void => {
  if (typeof value === "string") {
    identifiers.add(value)
    return
  }
  if (value === null || typeof value !== "object" || visited.has(value)) return
  visited.add(value)
  for (const child of Object.values(value))
    collectStringIdentifiers(child, identifiers, visited)
}

const collectLogicalIdentifiers = (
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTraces,
  identifiers: Set<string>,
): void => {
  for (const connection of srj.connections) {
    identifiers.add(connection.name)
    for (const rootName of connection.__rootConnectionNames ?? [])
      identifiers.add(rootName)
    if (connection.__netConnectionName)
      identifiers.add(connection.__netConnectionName)
    for (const point of connection.pointsToConnect) {
      if (point.pointId) identifiers.add(point.pointId)
      if ("pcb_port_id" in point && point.pcb_port_id)
        identifiers.add(point.pcb_port_id)
    }
  }
  for (const obstacle of srj.obstacles) {
    for (const id of obstacle.connectedTo) identifiers.add(id)
    for (const id of obstacle.offBoardConnectsTo ?? []) identifiers.add(id)
  }
  for (const trace of traces) {
    if (trace.connection_name) identifiers.add(trace.connection_name)
    for (const id of trace.connectsTo ?? []) identifiers.add(id)
  }
}

const getPhysicalLogicalCollisionIds = ({
  srjs,
  traces,
}: {
  srjs: SimpleRouteJson[]
  traces: SimplifiedPcbTraces
}): Set<string> => {
  const logicalSrj: SimpleRouteJson = {
    ...srjs[0]!,
    connections: srjs.flatMap((srj) => srj.connections),
    obstacles: srjs.flatMap((srj) => srj.obstacles),
    traces: [],
  }
  const logicalConnectivityMap =
    getConnectivityMapFromSimpleRouteJson(logicalSrj)
  const srjLogicalIdentifiers = new Set<string>()
  for (const srj of srjs)
    collectLogicalIdentifiers(srj, [], srjLogicalIdentifiers)
  const collisionIds = new Set<string>()
  const knownSameNet = (
    a: string | undefined,
    b: string | undefined,
  ): boolean =>
    Boolean(a && b && (a === b || logicalConnectivityMap.areIdsConnected(a, b)))

  for (const trace of traces) {
    const physicalId = trace.pcb_trace_id
    if (
      srjLogicalIdentifiers.has(physicalId) &&
      !knownSameNet(trace.connection_name, physicalId)
    ) {
      collisionIds.add(physicalId)
      continue
    }
    for (const otherTrace of traces) {
      if (otherTrace === trace) continue
      const aliases = [
        otherTrace.connection_name,
        ...(otherTrace.connectsTo ?? []),
      ]
      if (
        aliases.includes(physicalId) &&
        !knownSameNet(trace.connection_name, otherTrace.connection_name)
      ) {
        collisionIds.add(physicalId)
        break
      }
    }
  }
  return collisionIds
}

const createEvaluationSrj = ({
  srj,
  fixedPreloadedTraces,
}: {
  srj: SimpleRouteJson
  fixedPreloadedTraces: SimplifiedPcbTraces
}): SimpleRouteJson => ({
  ...srj,
  traces: fixedPreloadedTraces,
})

export class PostPowerDrcRepairSolver extends BaseSolver {
  readonly originalSrj: SimpleRouteJson
  readonly srjWithPointPairs: SimpleRouteJson
  readonly evaluationInputSrj: SimpleRouteJson
  readonly evaluationSrjWithPointPairs: SimpleRouteJson
  readonly fixedPreloadedTraces: SimplifiedPcbTraces
  readonly layerCount: number
  readonly maxCandidateEvaluations: number
  readonly maxRuntimeMs: number
  readonly maxLocalShiftRepairs: number
  readonly maxLayerLiftRepairs: number
  readonly defaultViaDiameter: number
  readonly supplementalConnMap: ConnectivityMap
  readonly inputValidationError?: string
  outputTraces: SimplifiedPcbTraces
  private startedAt = 0
  private evaluationCache = new WeakMap<SimplifiedPcbTraces, Evaluation>()
  private outputVersion = 0
  private junctionCache = new Map<string, LayerPoint[]>()
  private baselineGuardErrorSeverityVectorsById = new Map<string, number[]>()
  private immutableTargetErrorIdCounts = new Map<string, number>()
  private mutableTraceIds = new Set<string>()

  declare stats: PostPowerDrcRepairStats

  constructor(options: PostPowerDrcRepairSolverOptions) {
    super()
    const effort = options.effort ?? 1
    this.originalSrj = options.originalSrj
    this.srjWithPointPairs = options.srjWithPointPairs
    this.layerCount = options.originalSrj.layerCount
    this.outputTraces = structuredClone(options.traces)
    this.mutableTraceIds = new Set(
      this.outputTraces.map((trace) => trace.pcb_trace_id),
    )
    const reservedIdentifiers = new Set<string>()
    collectStringIdentifiers(options.originalSrj, reservedIdentifiers)
    collectStringIdentifiers(options.srjWithPointPairs, reservedIdentifiers)
    collectStringIdentifiers(this.outputTraces, reservedIdentifiers)
    const replacedPreloadedIds = new Set(
      this.outputTraces.flatMap((trace) =>
        trace.__replaces_pcb_trace_id ? [trace.__replaces_pcb_trace_id] : [],
      ),
    )
    const activePhysicalTraces = [
      ...(options.originalSrj.traces ?? []).filter(
        (trace) => !replacedPreloadedIds.has(trace.pcb_trace_id),
      ),
      ...this.outputTraces,
    ]
    const physicalLogicalCollisionIds = getPhysicalLogicalCollisionIds({
      srjs: [options.originalSrj, options.srjWithPointPairs],
      traces: activePhysicalTraces,
    })
    const evaluationPreloads = createEvaluationFixedPreloadedTraces({
      preloadedTraces: options.originalSrj.traces ?? [],
      routedTraces: this.outputTraces,
      reservedIdentifiers,
      physicalLogicalCollisionIds,
    })
    this.fixedPreloadedTraces = evaluationPreloads.traces
    this.inputValidationError = evaluationPreloads.inputValidationError
    this.evaluationInputSrj = createEvaluationSrj({
      srj: options.originalSrj,
      fixedPreloadedTraces: this.fixedPreloadedTraces,
    })
    this.evaluationSrjWithPointPairs = createEvaluationSrj({
      srj: options.srjWithPointPairs,
      fixedPreloadedTraces: this.fixedPreloadedTraces,
    })
    this.maxCandidateEvaluations =
      options.maxCandidateEvaluations ?? Math.max(128, Math.round(512 * effort))
    this.maxRuntimeMs = options.maxRuntimeMs ?? Number.POSITIVE_INFINITY
    this.maxLocalShiftRepairs =
      options.maxLocalShiftRepairs ?? Math.max(12, Math.round(12 * effort))
    this.maxLayerLiftRepairs =
      options.maxLayerLiftRepairs ?? Math.max(4, Math.round(4 * effort))
    this.defaultViaDiameter = getViaDimensions(options.originalSrj).padDiameter
    this.supplementalConnMap = getConnectivityMapFromSimpleRouteJson({
      ...this.evaluationSrjWithPointPairs,
      traces: combinePreloadedAndRoutedTraces(
        this.fixedPreloadedTraces,
        this.outputTraces,
      ),
    })
    if (!this.inputValidationError) {
      const immutableEvaluation = this.evaluate([])
      for (const errorId of immutableEvaluation.errorIds) {
        this.immutableTargetErrorIdCounts.set(
          errorId,
          (this.immutableTargetErrorIdCounts.get(errorId) ?? 0) + 1,
        )
      }
    }
    this.evaluationCache = new WeakMap()
    this.stats = {
      initialDrcErrorCount: 0,
      finalDrcErrorCount: 0,
      initialViaInPadCount: 0,
      finalViaInPadCount: 0,
      initialGuardErrorCount: 0,
      finalGuardErrorCount: 0,
      candidateEvaluationCount: 0,
      acceptedCandidateCount: 0,
      acceptedViaRelocationCount: 0,
      acceptedViaInPadRelocationCount: 0,
      acceptedLocalShiftCount: 0,
      acceptedLayerLiftCount: 0,
      candidateBudgetExhausted: false,
      runtimeBudgetExhausted: false,
      unsupportedRouteTypes: [],
      remainingDrcErrorIds: [],
      remainingViaInPadIds: [],
      remainingGuardErrorIds: [],
    }
    this.MAX_ITERATIONS = 1
  }

  override getSolverName(): string {
    return "PostPowerDrcRepairSolver"
  }

  private evaluate(traces: SimplifiedPcbTraces): Evaluation {
    const cached = this.evaluationCache.get(traces)
    if (cached) return cached
    const combinedTraces = combinePreloadedAndRoutedTraces(
      this.fixedPreloadedTraces,
      traces,
    )
    const specialRouteTraceIds = new Set(
      combinedTraces
        .filter((trace) =>
          trace.route.some(
            (point) =>
              point.route_type === "jumper" ||
              point.route_type === "through_obstacle",
          ),
        )
        .map((trace) => trace.pcb_trace_id),
    )
    const circuitJson = convertToCircuitJson(
      this.evaluationSrjWithPointPairs,
      combinedTraces,
      {
        minTraceWidth: this.evaluationInputSrj.minTraceWidth,
        minViaDiameter: this.evaluationInputSrj.minViaDiameter,
        originalSrj: this.evaluationInputSrj,
        includeOriginalConnections: true,
      },
    )
    const circuitJsonForCopperChecks = keepOnlyRoutingDomainPadRecords(
      circuitJson,
      this.originalSrj,
    )
    const copperDrc = getDrcErrors(circuitJsonForCopperChecks, {
      supplementalConnMap: this.supplementalConnMap,
      traceClearance: this.originalSrj.minTraceToPadEdgeClearance ?? 0.1,
      includeBoardEdge: false,
      includeTraceContinuity: false,
    })
    const srjObstacleClearanceErrors = getSrjObstacleClearanceErrors({
      traces: combinedTraces,
      srj: this.evaluationInputSrj,
      connectivityMap: this.supplementalConnMap,
    })
    const mutableTerminalPadErrors = srjObstacleClearanceErrors.filter(
      (error) => {
        if (
          error.is_terminal_pad_clearance !== true ||
          typeof error.pcb_trace_id !== "string" ||
          !this.mutableTraceIds.has(error.pcb_trace_id)
        )
          return false
        const obstacleIndex = error.srj_obstacle_index
        const obstacle =
          typeof obstacleIndex === "number"
            ? this.evaluationInputSrj.obstacles[obstacleIndex]
            : undefined
        const hasExactCircuitPadRecord =
          obstacle !== undefined &&
          (!obstacleIsOval(obstacle) || obstacleIsCircular(obstacle)) &&
          circuitJson.some((pad) => circuitPadMatchesObstacle(pad, obstacle))
        return !hasExactCircuitPadRecord
      },
    )
    const unpartitionedTargetErrors = [
      ...(copperDrc.errorsWithCenters as unknown as DrcErrorRecord[]),
      ...getViaPadClearanceErrors({
        circuitJson,
        srj: this.originalSrj,
        supplementalConnMap: this.supplementalConnMap,
        prefilteredCircuitJson: circuitJsonForCopperChecks,
      }),
      ...mutableTerminalPadErrors,
    ]
    const remainingImmutableErrorCounts = new Map(
      this.immutableTargetErrorIdCounts,
    )
    const errorsWithCenters: DrcErrorRecord[] = []
    const immutableGuardErrors: DrcErrorRecord[] = []
    for (const error of unpartitionedTargetErrors) {
      const errorId = getDrcErrorIdentity(error)
      const remainingCount = remainingImmutableErrorCounts.get(errorId) ?? 0
      const involvesSpecialRoute = drcErrorInvolvesAnyTrace({
        error,
        traces: combinedTraces,
        circuitJson,
        traceIds: specialRouteTraceIds,
      })
      if (remainingCount > 0 || involvesSpecialRoute) {
        immutableGuardErrors.push(error)
        if (remainingCount > 0)
          remainingImmutableErrorCounts.set(errorId, remainingCount - 1)
      } else {
        errorsWithCenters.push(error)
      }
    }
    const allViaInPadConflicts = [
      ...new Map(
        [
          ...getCheckedViaInPadConflicts({
            circuitJson,
            srj: this.originalSrj,
            prefilteredCircuitJson: circuitJsonForCopperChecks,
          }),
          ...getSrjViaInPadConflicts({
            circuitJson,
            traces: combinedTraces,
            srj: this.originalSrj,
          }),
        ].map((conflict) => [conflict.identity, conflict]),
      ).values(),
    ].sort((a, b) => a.identity.localeCompare(b.identity))
    const viaInPadConflicts = allViaInPadConflicts.filter(
      (conflict) =>
        typeof conflict.via.pcb_trace_id === "string" &&
        this.mutableTraceIds.has(conflict.via.pcb_trace_id) &&
        !specialRouteTraceIds.has(conflict.via.pcb_trace_id),
    )
    const immutableViaInPadGuardErrors = allViaInPadConflicts
      .filter((conflict) => !viaInPadConflicts.includes(conflict))
      .map(
        (conflict): DrcErrorRecord => ({
          type: "pcb_fixed_via_in_pad_guard_error",
          pcb_fixed_via_in_pad_guard_error_id: `fixed_via_in_pad:${conflict.identity}`,
          pcb_trace_id: conflict.via.pcb_trace_id,
          pcb_via_id: conflict.via.pcb_via_id,
          center: { x: conflict.via.x, y: conflict.via.y },
          message: `Immutable via ${conflict.via.pcb_via_id} is inside pad ${conflict.padId}`,
        }),
      )
    const guardErrorsWithCenters = [
      ...immutableGuardErrors,
      ...immutableViaInPadGuardErrors,
      ...getViaBoardEdgeErrors({
        traces: combinedTraces,
        srj: this.originalSrj,
      }),
      ...getTraceBoardEdgeErrors({
        traces: combinedTraces,
        srj: this.originalSrj,
      }),
      ...getTraceGeometryRuleErrors({
        traces: combinedTraces,
        srj: this.originalSrj,
      }),
      ...getSrjConnectedObstacleBoardEdgeErrors({
        srj: this.originalSrj,
      }),
      ...getSameNetViaObstacleContainmentGuardErrors({
        traces: combinedTraces,
        srj: this.originalSrj,
        connectivityMap: this.supplementalConnMap,
      }),
      ...getJumperPadClearanceGuardErrors({
        traces: combinedTraces,
        srj: this.originalSrj,
        connectivityMap: this.supplementalConnMap,
      }),
      ...srjObstacleClearanceErrors.filter(
        (error) => !mutableTerminalPadErrors.includes(error),
      ),
    ]
    const errorIds = errorsWithCenters.map(getDrcErrorIdentity)
    const guardErrorIds = guardErrorsWithCenters.map(getDrcErrorIdentity)
    const viaInPadIds = viaInPadConflicts.map((conflict) => conflict.identity)
    const evaluation = {
      circuitJson,
      errorsWithCenters,
      errorIds,
      errorIdSet: new Set(errorIds),
      errorSeverityVectorsById: getErrorSeverityVectorsById(errorsWithCenters),
      guardErrorIds,
      guardErrorSeverityVectorsById: getErrorSeverityVectorsById(
        guardErrorsWithCenters,
      ),
      viaInPadIds,
      viaInPadIdSet: new Set(viaInPadIds),
      viaInPadConflicts,
    }
    this.evaluationCache.set(traces, evaluation)
    return evaluation
  }

  private budgetAllowsCandidate(): boolean {
    if (this.stats.candidateEvaluationCount >= this.maxCandidateEvaluations) {
      this.stats.candidateBudgetExhausted = true
      return false
    }
    if (performance.now() - this.startedAt >= this.maxRuntimeMs) {
      this.stats.runtimeBudgetExhausted = true
      return false
    }
    return true
  }

  private replacementPreservesInvariants(
    replacement: SimplifiedPcbTrace,
  ): boolean {
    const previousTrace = this.outputTraces.find(
      (trace) => trace.pcb_trace_id === replacement.pcb_trace_id,
    )
    if (
      !previousTrace ||
      !hasPreservedTraceStructure(previousTrace, replacement) ||
      !isTraceMutationAllowedByRoutingPolicy({
        trace: previousTrace,
        srj: this.originalSrj,
        connectivityMap: this.supplementalConnMap,
      })
    )
      return false
    const junctionCacheKey = `${this.outputVersion}:${previousTrace.pcb_trace_id}`
    let requiredJunctions = this.junctionCache.get(junctionCacheKey)
    if (!requiredJunctions) {
      const otherJointTraces = combinePreloadedAndRoutedTraces(
        this.fixedPreloadedTraces,
        this.outputTraces,
      ).filter((trace) => trace !== previousTrace)
      requiredJunctions = getRequiredSameNetJunctions({
        trace: previousTrace,
        otherTraces: otherJointTraces,
        connectivityMap: this.supplementalConnMap,
        layerCount: this.layerCount,
        defaultViaDiameter: this.defaultViaDiameter,
      })
      this.junctionCache.set(junctionCacheKey, requiredJunctions)
    }
    return (
      requiredJunctions.every((junction) =>
        traceHasCopperAt(
          replacement,
          junction,
          this.layerCount,
          this.defaultViaDiameter,
        ),
      ) &&
      hasPreservedConnectionPointContacts({
        before: previousTrace,
        candidate: replacement,
        srj: this.originalSrj,
        connectivityMap: this.supplementalConnMap,
        defaultViaDiameter: this.defaultViaDiameter,
      }) &&
      this.evaluationInputSrj.obstacles.every(
        (obstacle) =>
          !traceIsConnectedToObstacle({
            trace: previousTrace,
            obstacle,
            connectivityMap: this.supplementalConnMap,
          }) ||
          !traceTouchesObstacleCopper({
            trace: previousTrace,
            obstacle,
            layerCount: this.layerCount,
            defaultViaDiameter: this.defaultViaDiameter,
          }) ||
          traceTouchesObstacleCopper({
            trace: replacement,
            obstacle,
            layerCount: this.layerCount,
            defaultViaDiameter: this.defaultViaDiameter,
          }),
      )
    )
  }

  private tryCandidate(
    replacement: SimplifiedPcbTrace,
    acceptedKind: "via-in-pad" | "via" | "shift" | "lift",
    requiredRemovedErrorIds: ReadonlySet<string> = new Set(),
  ): boolean {
    if (!this.budgetAllowsCandidate()) return false
    if (!this.replacementPreservesInvariants(replacement)) return false
    const before = this.evaluate(this.outputTraces)
    const candidateTraces = replaceTrace(this.outputTraces, replacement)
    this.stats.candidateEvaluationCount++
    const candidate = this.evaluate(candidateTraces)
    const copperStateDidNotWorsen = isErrorStateSubsetWithoutWorsening(
      before.errorSeverityVectorsById,
      candidate.errorSeverityVectorsById,
    )
    const copperStrictlyImproved =
      candidate.errorIds.length < before.errorIds.length
    const viaInPadDidNotWorsen = isIdentitySubset(
      before.viaInPadIdSet,
      candidate.viaInPadIds,
    )
    const viaInPadStrictlyImproved =
      candidate.viaInPadIds.length < before.viaInPadIds.length
    const removedRequiredErrors = [...requiredRemovedErrorIds].every(
      (errorId) => !candidate.errorIdSet.has(errorId),
    )
    const guardStateDidNotWorsen = isErrorStateSubsetWithoutWorsening(
      this.baselineGuardErrorSeverityVectorsById,
      candidate.guardErrorSeverityVectorsById,
    )
    const accepted =
      removedRequiredErrors && acceptedKind === "via-in-pad"
        ? copperStateDidNotWorsen &&
          viaInPadDidNotWorsen &&
          viaInPadStrictlyImproved &&
          guardStateDidNotWorsen
        : removedRequiredErrors &&
          copperStateDidNotWorsen &&
          copperStrictlyImproved &&
          viaInPadDidNotWorsen &&
          guardStateDidNotWorsen
    if (!accepted) {
      return false
    }
    this.outputTraces = candidateTraces
    this.outputVersion++
    this.stats.acceptedCandidateCount++
    if (acceptedKind === "via" || acceptedKind === "via-in-pad")
      this.stats.acceptedViaRelocationCount++
    if (acceptedKind === "via-in-pad")
      this.stats.acceptedViaInPadRelocationCount++
    if (acceptedKind === "shift") this.stats.acceptedLocalShiftCount++
    if (acceptedKind === "lift") this.stats.acceptedLayerLiftCount++
    return true
  }

  private tryGroupedCandidate({
    replacements,
    requiredRemovedErrorIds,
  }: {
    replacements: SimplifiedPcbTraces
    requiredRemovedErrorIds: ReadonlySet<string>
  }): boolean {
    if (
      !this.budgetAllowsCandidate() ||
      replacements.length < 2 ||
      new Set(replacements.map((trace) => trace.pcb_trace_id)).size !==
        replacements.length ||
      !replacements.every((replacement) =>
        this.replacementPreservesInvariants(replacement),
      )
    )
      return false
    const before = this.evaluate(this.outputTraces)
    const replacementsById = new Map(
      replacements.map((trace) => [trace.pcb_trace_id, trace]),
    )
    const candidateTraces = this.outputTraces.map(
      (trace) => replacementsById.get(trace.pcb_trace_id) ?? trace,
    )
    this.stats.candidateEvaluationCount++
    const candidate = this.evaluate(candidateTraces)
    const accepted =
      [...requiredRemovedErrorIds].every(
        (errorId) => !candidate.errorIdSet.has(errorId),
      ) &&
      candidate.errorIds.length < before.errorIds.length &&
      isErrorStateSubsetWithoutWorsening(
        before.errorSeverityVectorsById,
        candidate.errorSeverityVectorsById,
      ) &&
      isIdentitySubset(before.viaInPadIdSet, candidate.viaInPadIds) &&
      isErrorStateSubsetWithoutWorsening(
        this.baselineGuardErrorSeverityVectorsById,
        candidate.guardErrorSeverityVectorsById,
      )
    if (!accepted) return false
    this.outputTraces = candidateTraces
    this.outputVersion++
    this.stats.acceptedCandidateCount++
    this.stats.acceptedViaRelocationCount++
    this.stats.acceptedLocalShiftCount++
    return true
  }

  private repairViaInPadErrors(): void {
    if (this.originalSrj.allowViaInPad) return
    const attemptedWithoutImprovement = new Set<string>()
    while (true) {
      const evaluation = this.evaluate(this.outputTraces)
      const conflict = evaluation.viaInPadConflicts.find(
        (candidate) => !attemptedWithoutImprovement.has(candidate.identity),
      )
      if (!conflict) return
      const ownerTraceId = conflict.via.pcb_trace_id
      const ownerTrace = ownerTraceId
        ? this.outputTraces.find((trace) => trace.pcb_trace_id === ownerTraceId)
        : undefined
      if (!ownerTrace) {
        attemptedWithoutImprovement.add(conflict.identity)
        continue
      }
      const viaIndex = findViaIndex(ownerTrace, conflict.via)
      if (viaIndex < 1 || viaIndex >= ownerTrace.route.length - 1) {
        attemptedWithoutImprovement.add(conflict.identity)
        continue
      }
      let improved = false
      for (const offset of createRadialGridOffsets({
        maxDistance: 2,
        maxCandidates: 80,
      })) {
        const candidate = relocateViaVertex(ownerTrace, viaIndex, offset)
        if (candidate && this.tryCandidate(candidate, "via-in-pad")) {
          improved = true
          break
        }
        if (!this.budgetAllowsCandidate()) return
      }
      if (!improved) attemptedWithoutImprovement.add(conflict.identity)
    }
  }

  private repairTypedViaClearanceErrors(): void {
    const initial = this.evaluate(this.outputTraces)
    const viaRecords = new Map(
      initial.circuitJson.flatMap((element) =>
        element.type === "pcb_via" &&
        typeof element.pcb_via_id === "string" &&
        typeof element.pcb_trace_id === "string"
          ? [[element.pcb_via_id, element] as const]
          : [],
      ),
    )
    const padsById = new Map(
      initial.circuitJson.flatMap((element) => {
        const padId = getCircuitPadId(element)
        return padId &&
          "x" in element &&
          "y" in element &&
          typeof element.x === "number" &&
          typeof element.y === "number"
          ? [[padId, element] as const]
          : []
      }),
    )
    const seenViaIds = new Set<string>()
    for (const error of initial.errorsWithCenters) {
      if (
        error.type !== "pcb_via_trace_clearance_error" &&
        error.type !== "pcb_pad_pad_clearance_error"
      )
        continue
      const viaId =
        error.pcb_via_id ??
        error.pcb_pad_ids?.find((padId) => viaRecords.has(padId))
      if (!viaId || seenViaIds.has(viaId)) continue
      seenViaIds.add(viaId)
      const targetErrors = initial.errorsWithCenters.filter(
        (candidateError) => {
          if (
            candidateError.type !== "pcb_via_trace_clearance_error" &&
            candidateError.type !== "pcb_pad_pad_clearance_error"
          )
            return false
          return (
            candidateError.pcb_via_id === viaId ||
            candidateError.pcb_pad_ids?.includes(viaId) === true
          )
        },
      )
      const requiredRemovedErrorIds = new Set(
        targetErrors.map(getDrcErrorIdentity),
      )
      const viaRecord = viaRecords.get(viaId)
      if (!viaRecord) continue
      const ownerTrace = this.outputTraces.find(
        (trace) => trace.pcb_trace_id === viaRecord.pcb_trace_id,
      )
      if (!ownerTrace) continue
      const viaIndex = findViaIndex(ownerTrace, viaRecord)
      if (viaIndex < 1 || viaIndex >= ownerTrace.route.length - 1) continue
      const foreignPads = targetErrors.flatMap((targetError) =>
        (targetError.pcb_pad_ids ?? []).flatMap((padId) => {
          if (padId === viaId) return []
          const pad = padsById.get(padId)
          return pad ? [pad] : []
        }),
      )
      const directedOffsets =
        foreignPads.length === 1 &&
        typeof viaRecord.x === "number" &&
        typeof viaRecord.y === "number"
          ? createOffsetsAwayFromPoint({
              origin: { x: viaRecord.x, y: viaRecord.y },
              obstacleCenter: {
                x: foreignPads[0]!.x,
                y: foreignPads[0]!.y,
              },
              maxDistance: 0.3,
            })
          : []
      const offsets =
        directedOffsets.length > 0
          ? directedOffsets
          : createRadialGridOffsets({
              maxDistance: 2,
              maxCandidates: 80,
            })
      for (const offset of offsets) {
        const candidate = relocateViaVertex(ownerTrace, viaIndex, offset)
        if (
          candidate &&
          this.tryCandidate(candidate, "via", requiredRemovedErrorIds)
        )
          break
        if (!this.budgetAllowsCandidate()) return
      }
    }
  }

  private tryLocalShift({
    trace,
    center,
    selectionRadius = 0.45,
    maxShift = 0.8,
    maxCandidates = 80,
    requiredRemovedErrorIds = new Set(),
    preferredOffsets = [],
  }: {
    trace: SimplifiedPcbTrace
    center: Point
    selectionRadius?: number
    maxShift?: number
    maxCandidates?: number
    requiredRemovedErrorIds?: ReadonlySet<string>
    preferredOffsets?: Array<{ dx: number; dy: number; distance: number }>
  }): boolean {
    const offsets = [
      ...preferredOffsets,
      ...createRadialGridOffsets({
        maxDistance: maxShift,
        maxCandidates,
      }),
    ]
    for (const offset of offsets) {
      const candidate = translateLocalTraceVertices({
        trace,
        center,
        selectionRadius,
        ...offset,
      })
      if (
        candidate &&
        this.tryCandidate(candidate, "shift", requiredRemovedErrorIds)
      )
        return true
      if (!this.budgetAllowsCandidate()) return false
    }
    return false
  }

  private repairLocalizedErrors({
    includeViaPad,
  }: {
    includeViaPad: boolean
  }): void {
    while (this.stats.acceptedLocalShiftCount < this.maxLocalShiftRepairs) {
      const evaluation = this.evaluate(this.outputTraces)
      const viaRecords = new Map(
        evaluation.circuitJson.flatMap((element) =>
          element.type === "pcb_via" && typeof element.pcb_via_id === "string"
            ? [[element.pcb_via_id, element] as const]
            : [],
        ),
      )
      const padsById = new Map(
        evaluation.circuitJson.flatMap((element) => {
          const padId = getCircuitPadId(element)
          return padId &&
            "x" in element &&
            "y" in element &&
            typeof element.x === "number" &&
            typeof element.y === "number"
            ? [[padId, element] as const]
            : []
        }),
      )
      let improved = false
      for (const error of evaluation.errorsWithCenters) {
        if (!includeViaPad && error.type === "pcb_pad_pad_clearance_error")
          continue
        let center = error.center
        const participants = getTraceParticipants(error, this.outputTraces)
        if (error.type === "pcb_via_trace_clearance_error") {
          const via = error.pcb_via_id
            ? viaRecords.get(error.pcb_via_id)
            : undefined
          if (via && typeof via.x === "number" && typeof via.y === "number") {
            center = { x: via.x, y: via.y }
          }
        }
        if (!center || participants.length !== 1) continue
        const trace = participants[0]!
        const via = error.pcb_via_id
          ? viaRecords.get(error.pcb_via_id)
          : undefined
        const foreignPadId = error.pcb_pad_ids?.find(
          (padId) => padId !== error.pcb_via_id,
        )
        const foreignPad = foreignPadId ? padsById.get(foreignPadId) : undefined
        if (
          this.tryLocalShift({
            trace,
            center,
            selectionRadius:
              error.type === "pcb_via_trace_clearance_error" ||
              error.type === "pcb_pad_pad_clearance_error"
                ? 0.55
                : 0.45,
            maxShift:
              error.type === "pcb_via_trace_clearance_error" ? 0.5 : 0.8,
            requiredRemovedErrorIds:
              error.type === "pcb_pad_pad_clearance_error"
                ? new Set([getDrcErrorIdentity(error)])
                : undefined,
            preferredOffsets:
              error.type === "pcb_pad_pad_clearance_error" && via && foreignPad
                ? createOffsetsAwayFromPoint({
                    origin: { x: via.x, y: via.y },
                    obstacleCenter: { x: foreignPad.x, y: foreignPad.y },
                    maxDistance: 0.5,
                  })
                : undefined,
          })
        ) {
          improved = true
          break
        }
        if (!this.budgetAllowsCandidate()) return
      }
      if (!improved) return
    }
  }

  /**
   * A via can be caged between its foreign pad and one neighboring trace. Try
   * the smallest coupled move: move the via away from the pad and translate a
   * local window of the sole newly-conflicting trace in the same direction.
   * Owners come exclusively from checker records and connectivity metadata.
   */
  private repairCagedViaPadErrors(): void {
    if (this.stats.acceptedLocalShiftCount >= this.maxLocalShiftRepairs) return
    const before = this.evaluate(this.outputTraces)
    for (const error of before.errorsWithCenters) {
      if (error.type !== "pcb_pad_pad_clearance_error") continue
      const viaId = error.pcb_via_id
      const foreignPadId = error.pcb_pad_ids?.find((padId) => padId !== viaId)
      if (!viaId || !foreignPadId) continue
      const via = before.circuitJson.find(
        (element): element is CircuitPcbVia =>
          element.type === "pcb_via" &&
          element.pcb_via_id === viaId &&
          Array.isArray(element.layers),
      )
      const pad = before.circuitJson.find(
        (element) => getCircuitPadId(element) === foreignPadId,
      )
      if (
        !via ||
        typeof via.pcb_trace_id !== "string" ||
        !pad ||
        !("x" in pad) ||
        !("y" in pad) ||
        typeof pad.x !== "number" ||
        typeof pad.y !== "number"
      )
        continue
      const ownerTrace = this.outputTraces.find(
        (trace) => trace.pcb_trace_id === via.pcb_trace_id,
      )
      if (!ownerTrace) continue
      const viaIndex = findViaIndex(ownerTrace, via)
      if (viaIndex < 1 || viaIndex >= ownerTrace.route.length - 1) continue
      const requiredRemovedErrorIds = new Set([getDrcErrorIdentity(error)])
      for (const viaOffset of createOffsetsAwayFromPoint({
        origin: { x: via.x, y: via.y },
        obstacleCenter: { x: pad.x, y: pad.y },
        minDistance: GRID_STEP,
        maxDistance: 0.3,
      })) {
        const ownerCandidate = relocateViaVertex(
          ownerTrace,
          viaIndex,
          viaOffset,
        )
        if (
          !ownerCandidate ||
          !this.replacementPreservesInvariants(ownerCandidate) ||
          !this.budgetAllowsCandidate()
        )
          continue
        const viaCandidateTraces = replaceTrace(
          this.outputTraces,
          ownerCandidate,
        )
        this.stats.candidateEvaluationCount++
        const viaCandidateEvaluation = this.evaluate(viaCandidateTraces)
        if (
          viaCandidateEvaluation.errorIdSet.has(getDrcErrorIdentity(error)) ||
          !isIdentitySubset(
            before.viaInPadIdSet,
            viaCandidateEvaluation.viaInPadIds,
          )
        )
          continue
        const newErrors = viaCandidateEvaluation.errorsWithCenters.filter(
          (candidateError) =>
            !before.errorIdSet.has(getDrcErrorIdentity(candidateError)),
        )
        const blockerIds = new Set<string>()
        let everyNewErrorHasBlocker = newErrors.length > 0
        for (const newError of newErrors) {
          const participants = getTraceParticipants(
            newError,
            viaCandidateTraces,
          ).filter((trace) => trace.pcb_trace_id !== ownerTrace.pcb_trace_id)
          if (participants.length === 0) everyNewErrorHasBlocker = false
          for (const participant of participants)
            blockerIds.add(participant.pcb_trace_id)
        }
        if (!everyNewErrorHasBlocker || blockerIds.size !== 1) continue
        const blockerTrace = this.outputTraces.find(
          (trace) => trace.pcb_trace_id === [...blockerIds][0],
        )
        if (!blockerTrace) continue
        const movedVia = ownerCandidate.route[viaIndex]
        if (movedVia?.route_type !== "via") continue
        const nearestMovablePoint = blockerTrace.route
          .slice(1, -1)
          .filter(
            (point): point is WirePoint | ViaPoint =>
              point.route_type === "wire" || point.route_type === "via",
          )
          .sort(
            (a, b) =>
              Math.hypot(a.x - movedVia.x, a.y - movedVia.y) -
              Math.hypot(b.x - movedVia.x, b.y - movedVia.y),
          )[0]
        if (!nearestMovablePoint) continue
        const blockerOffsets = createOffsetsAwayFromPoint({
          origin: nearestMovablePoint,
          obstacleCenter: movedVia,
          minDistance: GRID_STEP,
          maxDistance: 0.5,
        })
        for (const selectionRadius of [0.3, 0.45, 0.6, 0.8, 1, 1.5]) {
          for (const blockerOffset of blockerOffsets) {
            const blockerCandidate = translateLocalTraceVertices({
              trace: blockerTrace,
              center: movedVia,
              selectionRadius,
              ...blockerOffset,
            })
            if (
              blockerCandidate &&
              this.tryGroupedCandidate({
                replacements: [ownerCandidate, blockerCandidate],
                requiredRemovedErrorIds,
              })
            )
              return
            if (!this.budgetAllowsCandidate()) return
          }
        }
      }
    }
  }

  private getAllowedLiftLayers(trace: SimplifiedPcbTrace): string[] {
    return getPolicyAllowedLiftLayers({
      trace,
      srj: this.originalSrj,
      connectivityMap: this.supplementalConnMap,
    })
  }

  private tryLayerLift(trace: SimplifiedPcbTrace, center: Point): boolean {
    const layerNames = this.getAllowedLiftLayers(trace)
    for (const padding of [2, 3, 4, 5, 6, 8, 10, 12]) {
      for (const targetLayer of layerNames) {
        const candidate = liftLocalTraceWindow({
          trace,
          center,
          padding,
          targetLayer,
        })
        if (candidate && this.tryCandidate(candidate, "lift")) return true
        if (!this.budgetAllowsCandidate()) return false
      }
    }
    return false
  }

  private repairTraceTraceErrorsByLayerLift(): void {
    while (this.stats.acceptedLayerLiftCount < this.maxLayerLiftRepairs) {
      const evaluation = this.evaluate(this.outputTraces)
      let improved = false
      for (const error of evaluation.errorsWithCenters) {
        if (error.type !== "pcb_trace_error" || !error.center) continue
        const participants = getTraceParticipants(error, this.outputTraces)
        if (participants.length < 2) continue
        for (const trace of participants) {
          if (this.tryLayerLift(trace, error.center)) {
            improved = true
            break
          }
          if (!this.budgetAllowsCandidate()) return
        }
        if (improved) break
      }
      if (!improved) return
    }
  }

  override _step(): void {
    this.startedAt = performance.now()
    if (this.inputValidationError) {
      this.error = this.inputValidationError
      this.failed = true
      return
    }
    this.stats.unsupportedRouteTypes = [
      ...new Set(
        combinePreloadedAndRoutedTraces(
          this.fixedPreloadedTraces,
          this.outputTraces,
        ).flatMap((trace) =>
          trace.route.flatMap((point) =>
            point.route_type === "jumper" ||
            point.route_type === "through_obstacle"
              ? [point.route_type]
              : [],
          ),
        ),
      ),
    ].sort()
    const initial = this.evaluate(this.outputTraces)
    this.baselineGuardErrorSeverityVectorsById =
      initial.guardErrorSeverityVectorsById
    this.stats.initialDrcErrorCount = initial.errorIds.length
    this.stats.initialViaInPadCount = initial.viaInPadIds.length
    this.stats.initialGuardErrorCount = initial.guardErrorIds.length

    if (initial.errorIds.length === 0 && initial.viaInPadIds.length === 0) {
      this.stats.finalDrcErrorCount = 0
      this.stats.finalViaInPadCount = 0
      this.stats.finalGuardErrorCount = initial.guardErrorIds.length
      this.stats.remainingGuardErrorIds = initial.guardErrorIds
      this.solved = true
      return
    }
    if (initial.viaInPadIds.length > 0) this.repairViaInPadErrors()
    if (this.evaluate(this.outputTraces).errorIds.length > 0) {
      this.repairCagedViaPadErrors()
      this.repairTypedViaClearanceErrors()
      this.repairLocalizedErrors({ includeViaPad: false })
      this.repairTraceTraceErrorsByLayerLift()
      this.repairTypedViaClearanceErrors()
      this.repairCagedViaPadErrors()
      this.repairLocalizedErrors({ includeViaPad: true })
      this.repairTraceTraceErrorsByLayerLift()
    }
    if (this.evaluate(this.outputTraces).errorIds.length > 0) {
      this.repairCagedViaPadErrors()
      this.repairTypedViaClearanceErrors()
      this.repairLocalizedErrors({ includeViaPad: true })
      this.repairTraceTraceErrorsByLayerLift()
    }

    const final = this.evaluate(this.outputTraces)
    this.stats.finalDrcErrorCount = final.errorIds.length
    this.stats.finalViaInPadCount = final.viaInPadIds.length
    this.stats.finalGuardErrorCount = final.guardErrorIds.length
    this.stats.remainingDrcErrorIds = final.errorIds
    this.stats.remainingViaInPadIds = final.viaInPadIds
    this.stats.remainingGuardErrorIds = final.guardErrorIds
    const guardStateDidNotWorsen = isErrorStateSubsetWithoutWorsening(
      this.baselineGuardErrorSeverityVectorsById,
      final.guardErrorSeverityVectorsById,
    )
    if (
      final.errorIds.length > 0 ||
      final.viaInPadIds.length > 0 ||
      !guardStateDidNotWorsen
    ) {
      const budgetReason = this.stats.candidateBudgetExhausted
        ? ` Candidate budget ${this.maxCandidateEvaluations} was exhausted.`
        : this.stats.runtimeBudgetExhausted
          ? ` Runtime budget ${this.maxRuntimeMs}ms was exhausted.`
          : ""
      this.error =
        `Post-power DRC repair left ${final.errorIds.length} copper ` +
        `error(s), ${final.viaInPadIds.length} via-in-pad error(s), and ` +
        `${guardStateDidNotWorsen ? 0 : 1} guard regression state(s): ` +
        `${[
          ...final.errorIds,
          ...final.viaInPadIds,
          ...(!guardStateDidNotWorsen ? final.guardErrorIds : []),
        ].join(", ")}.${budgetReason}`
      this.failed = true
      return
    }
    this.solved = true
  }

  getOutput(): SimplifiedPcbTraces {
    return this.outputTraces
  }

  override visualize(): GraphicsObject {
    return { points: [], lines: [], rects: [], circles: [] }
  }
}
