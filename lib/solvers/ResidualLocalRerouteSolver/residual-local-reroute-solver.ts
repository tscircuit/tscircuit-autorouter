import {
  isPointInsidePolygon,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type { DrcEvaluator } from "high-density-repair03/lib"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"

type Point = { x: number; y: number }

type Bounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

type RoutingObstacle = {
  center: Point
  width: number
  height: number
  connectedTo?: readonly string[]
}

type DrcError = Record<string, unknown>

type DrcSnapshot = {
  errors: DrcError[]
  issueCount: number
  issueScore: number
}

type DoglegStrategy = {
  offset: number
  span: number
}

type LayerDetourStrategy = {
  scope: "segment" | "route"
  targetZ: number
  span: number
}

type DirectedDoglegStrategy = {
  distance: number
  span: number
}

type DirectedSegmentShiftStrategy = {
  distance: number
}

type TerminalSnapStrategy = {
  type: "terminal_snap"
}

type ObstacleDetourStrategy = {
  type: "obstacle_detour"
  side: "top" | "right" | "bottom" | "left"
  margin: number
}

type CandidateStrategy =
  | TerminalSnapStrategy
  | ObstacleDetourStrategy
  | ({ type: "dogleg" } & DoglegStrategy)
  | ({ type: "directed_dogleg" } & DirectedDoglegStrategy)
  | ({ type: "directed_pair_dogleg" } & DirectedDoglegStrategy)
  | ({ type: "directed_pair_shift" } & DirectedSegmentShiftStrategy)
  | ({ type: "directed_segment_shift" } & DirectedSegmentShiftStrategy)
  | ({ type: "directed_via_shift" } & DirectedSegmentShiftStrategy)
  | ({ type: "layer_detour" } & LayerDetourStrategy)

type CandidateTarget = {
  routeIndex: number
  center: Point
  severity: number
  errorType: string
  moveDirection?: Point
  otherRouteIndex?: number
  sourceZ?: number
  viaCenter?: Point
  viaRouteIndexes?: readonly number[]
  terminalPoint?: Point
  terminalPortId?: string
  obstacle?: RoutingObstacle
}

type RouteProjection = Point & { z: number }

type MoveData = {
  direction?: Point
  otherRouteIndex?: number
  sourceZ?: number
  obstacle?: RoutingObstacle
}

type CandidatePlanEntry = CandidateTarget &
  CandidateStrategy & {
    key: string
  }

export type ResidualLocalRerouteSolverConfig = {
  hdRoutes: readonly HighDensityRoute[]
  drcEvaluator: DrcEvaluator
  /** Optional cheaper scorer; every accepted candidate still uses drcEvaluator. */
  candidateDrcEvaluator?: DrcEvaluator
  bounds: Bounds
  outline?: readonly Point[]
  obstacles?: readonly RoutingObstacle[]
  layerCount: number
  effort: number
}

const ALL_DOGLEG_STRATEGIES: readonly DoglegStrategy[] = [
  { offset: -0.2, span: 0.24 },
  { offset: 0.2, span: 0.24 },
  { offset: -0.12, span: 0.24 },
  { offset: 0.12, span: 0.24 },
  { offset: -0.32, span: 0.24 },
  { offset: 0.32, span: 0.24 },
  { offset: -0.2, span: 0.12 },
  { offset: 0.2, span: 0.12 },
  { offset: -0.2, span: 0.4 },
  { offset: 0.2, span: 0.4 },
  { offset: -0.12, span: 0.12 },
  { offset: 0.12, span: 0.12 },
  { offset: -0.12, span: 0.4 },
  { offset: 0.12, span: 0.4 },
  { offset: -0.32, span: 0.12 },
  { offset: 0.32, span: 0.12 },
  { offset: -0.32, span: 0.4 },
  { offset: 0.32, span: 0.4 },
  { offset: -0.48, span: 0.4 },
  { offset: 0.48, span: 0.4 },
  { offset: -0.48, span: 0.7 },
  { offset: 0.48, span: 0.7 },
  { offset: -0.64, span: 0.7 },
  { offset: 0.64, span: 0.7 },
  { offset: -0.08, span: 0.24 },
  { offset: 0.08, span: 0.24 },
  { offset: -0.04, span: 0.24 },
  { offset: 0.04, span: 0.24 },
]

const SUPPORTED_ERROR_TYPES = new Set([
  "pcb_trace_error",
  "pcb_via_trace_clearance_error",
  "pcb_pad_trace_clearance_error",
])

const DEFAULT_TRACE_CLEARANCE = 0.1
const LAYER_DETOUR_SPANS = [0.24, 0.4, 0.7, 1.2] as const
const DIRECTED_DOGLEG_STRATEGIES: readonly DirectedDoglegStrategy[] = [
  { distance: 0.2, span: 0.4 },
  { distance: 0.12, span: 0.4 },
  { distance: 0.08, span: 0.24 },
  { distance: 0.04, span: 0.24 },
  { distance: 0.02, span: 0.24 },
  { distance: 0.01, span: 0.24 },
]
const DIRECTED_SEGMENT_SHIFT_STRATEGIES: readonly DirectedSegmentShiftStrategy[] =
  [
    { distance: 0.01 },
    { distance: 0.02 },
    { distance: 0.04 },
    { distance: 0.08 },
    { distance: 0.12 },
    { distance: 0.2 },
  ]

const getCandidateStrategyKey = (strategy: CandidateStrategy): string => {
  if (strategy.type === "terminal_snap") return strategy.type
  if (strategy.type === "obstacle_detour") {
    return `${strategy.type}:${strategy.side}:${strategy.margin}`
  }
  if (strategy.type === "layer_detour") {
    return `${strategy.type}:${strategy.scope}:${strategy.targetZ}:${strategy.span}`
  }
  if (
    strategy.type === "directed_dogleg" ||
    strategy.type === "directed_pair_dogleg"
  ) {
    return `${strategy.type}:${strategy.distance}:${strategy.span}`
  }
  if (
    strategy.type === "directed_segment_shift" ||
    strategy.type === "directed_pair_shift" ||
    strategy.type === "directed_via_shift"
  ) {
    return `${strategy.type}:${strategy.distance}`
  }
  return `${strategy.type}:${strategy.offset}:${strategy.span}`
}

const getCandidatePriority = (
  target: CandidateTarget,
  strategy: CandidateStrategy,
): number => {
  if (target.terminalPoint) {
    if (strategy.type === "terminal_snap") return 0
    return 1
  }
  if (target.viaCenter && target.viaRouteIndexes?.length) {
    if (strategy.type === "directed_via_shift") return 0
    if (strategy.type === "directed_segment_shift") return 1
    if (strategy.type === "directed_dogleg") return 2
    if (strategy.type === "layer_detour") return 3
    return 4
  }
  if (target.otherRouteIndex !== undefined) {
    if (strategy.type === "directed_pair_shift") return 0
    if (strategy.type === "directed_pair_dogleg") return 0.5
    if (strategy.type === "directed_segment_shift") return 1
    if (strategy.type === "directed_dogleg") return 2
    if (strategy.type === "layer_detour") return 3
    return 4
  }
  if (target.moveDirection) {
    if (strategy.type === "directed_segment_shift") return 0
    if (strategy.type === "directed_dogleg") return 1
    if (strategy.type === "layer_detour") return 2
    return 3
  }
  if (strategy.type === "layer_detour") return 0
  return 1
}

const getCandidateStrategyVariantRank = (
  target: CandidateTarget,
  strategy: CandidateStrategy,
): number => {
  if (strategy.type === "terminal_snap") return 0
  if (strategy.type === "obstacle_detour") {
    const sideRank = ["top", "right", "bottom", "left"].indexOf(strategy.side)
    return strategy.margin * 100 + sideRank
  }
  if (strategy.type === "layer_detour") {
    const spanIndex = LAYER_DETOUR_SPANS.findIndex(
      (candidateSpan) => candidateSpan === strategy.span,
    )
    return (
      spanIndex * 100 +
      strategy.targetZ * 2 +
      (strategy.scope === "route" ? 1 : 0)
    )
  }
  const distance =
    strategy.type === "dogleg" ? Math.abs(strategy.offset) : strategy.distance
  const desiredDistance = Math.min(0.2, Math.max(0.01, target.severity + 0.01))
  const distanceRank =
    distance >= desiredDistance
      ? distance - desiredDistance
      : 100 + desiredDistance - distance
  const spanRank =
    strategy.type === "dogleg" ||
    strategy.type === "directed_dogleg" ||
    strategy.type === "directed_pair_dogleg"
      ? strategy.span / 100
      : 0
  return distanceRank + spanRank
}

const getDrcErrorSeverity = (error: DrcError): number => {
  const message = typeof error.message === "string" ? error.message : ""
  const gap = Number.parseFloat(
    message.match(/gap: (-?\d+(?:\.\d+)?)mm/)?.[1] ?? "",
  )
  const required = Number.parseFloat(
    message.match(/required: (-?\d+(?:\.\d+)?)mm/)?.[1] ?? "",
  )
  if (Number.isFinite(gap)) {
    return Math.max(
      0,
      (Number.isFinite(required) ? required : DEFAULT_TRACE_CLEARANCE) - gap,
    )
  }

  const clearance = Number.parseFloat(
    message.match(/clearance: (-?\d+(?:\.\d+)?)mm/)?.[1] ?? "",
  )
  const minimum = Number.parseFloat(
    message.match(/minimum: (-?\d+(?:\.\d+)?)mm/)?.[1] ?? "",
  )
  return Number.isFinite(clearance) && Number.isFinite(minimum)
    ? Math.max(0, minimum - clearance)
    : 1
}

const getErrorCenter = (error: DrcError): Point | undefined => {
  const center = error.center ?? error.pcb_center
  if (!center || typeof center !== "object") return undefined
  const candidate = center as Record<string, unknown>
  if (typeof candidate.x !== "number" || typeof candidate.y !== "number") {
    return undefined
  }
  return { x: candidate.x, y: candidate.y }
}

const getDrcPointField = (
  error: DrcError,
  fieldName: string,
): Point | undefined => {
  const value = error[fieldName]
  if (!value || typeof value !== "object") return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.x !== "number" || typeof candidate.y !== "number") {
    return undefined
  }
  return { x: candidate.x, y: candidate.y }
}

const isTraceViaOverlapError = (error: DrcError): boolean =>
  error.type === "pcb_trace_error" &&
  typeof error.message === "string" &&
  error.message.includes("overlaps with pcb_via")

const isTracePadOverlapError = (error: DrcError): boolean =>
  error.type === "pcb_trace_error" &&
  typeof error.message === "string" &&
  error.message.includes("overlaps with pcb_smtpad")

const getNearestTransitionPoint = (
  center: Point,
  transitionPoints: readonly Point[],
): Point | undefined =>
  transitionPoints.reduce<Point | undefined>(
    (nearest, candidate) =>
      !nearest ||
      Math.hypot(candidate.x - center.x, candidate.y - center.y) <
        Math.hypot(nearest.x - center.x, nearest.y - center.y)
        ? candidate
        : nearest,
    undefined,
  )

const isBetterSnapshot = (
  candidate: DrcSnapshot,
  best: DrcSnapshot,
): boolean => {
  if (candidate.issueCount !== best.issueCount) {
    return candidate.issueCount < best.issueCount
  }
  return candidate.issueScore < best.issueScore - 1e-9
}

const isPointInsideBoard = (
  point: Point,
  polygon: readonly Point[],
  traceRadius: number,
): boolean => {
  if (!isPointInsidePolygon(point, polygon)) return false
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!
    const end = polygon[(index + 1) % polygon.length]!
    if (pointToSegmentDistance(point, start, end) < traceRadius - 1e-6) {
      return false
    }
  }
  return true
}

const doesDoglegStayInsideBoard = (
  doglegPoints: readonly Point[],
  polygon: readonly Point[],
  traceRadius: number,
): boolean => {
  for (
    let segmentIndex = 0;
    segmentIndex + 1 < doglegPoints.length;
    segmentIndex += 1
  ) {
    const start = doglegPoints[segmentIndex]!
    const end = doglegPoints[segmentIndex + 1]!
    for (let sampleIndex = 1; sampleIndex < 10; sampleIndex += 1) {
      const t = sampleIndex / 10
      const point = {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      }
      if (!isPointInsideBoard(point, polygon, traceRadius)) return false
    }
  }
  return true
}

const getBoardPolygon = (
  bounds: Bounds,
  outline?: readonly Point[],
): readonly Point[] => {
  if (outline && outline.length >= 3) return outline
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ]
}

const getTraceRouteIndexById = (
  routes: readonly HighDensityRoute[],
): Map<string, number> => {
  const routeCountByConnectionName = new Map<string, number>()
  const routeIndexByTraceId = new Map<string, number>()
  routes.forEach((route, routeIndex) => {
    const connectionRouteIndex =
      routeCountByConnectionName.get(route.connectionName) ?? 0
    routeIndexByTraceId.set(
      `${route.connectionName}_${connectionRouteIndex}`,
      routeIndex,
    )
    routeCountByConnectionName.set(
      route.connectionName,
      connectionRouteIndex + 1,
    )
  })
  return routeIndexByTraceId
}

const getTraceIdsForError = (error: DrcError): string[] => {
  const traceIds = error.pcb_trace_ids
  if (Array.isArray(traceIds)) {
    return [
      ...new Set(traceIds.filter((id): id is string => typeof id === "string")),
    ]
  }
  return typeof error.pcb_trace_id === "string" ? [error.pcb_trace_id] : []
}

const getNearestRouteProjection = (
  route: HighDensityRoute,
  center: Point,
): RouteProjection | undefined => {
  let nearest: { point: RouteProjection; distance: number } | undefined
  for (
    let segmentIndex = 0;
    segmentIndex + 1 < route.route.length;
    segmentIndex += 1
  ) {
    const start = route.route[segmentIndex]!
    const end = route.route[segmentIndex + 1]!
    if (
      start.z !== end.z ||
      start.toNextSegmentType === "through_obstacle" ||
      start.insideJumperPad ||
      end.insideJumperPad
    ) {
      continue
    }
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared <= 1e-8) continue
    const t = Math.max(
      0,
      Math.min(
        1,
        ((center.x - start.x) * dx + (center.y - start.y) * dy) / lengthSquared,
      ),
    )
    const point = { x: start.x + dx * t, y: start.y + dy * t, z: start.z }
    const distance = Math.hypot(center.x - point.x, center.y - point.y)
    if (!nearest || distance < nearest.distance) nearest = { point, distance }
  }
  return nearest?.point
}

const getNearestSameLayerProjectionPair = (
  route: HighDensityRoute,
  otherRoute: HighDensityRoute,
  center: Point,
):
  | {
      routePoint: RouteProjection
      obstaclePoint: RouteProjection
      score: number
    }
  | undefined => {
  let nearest:
    | {
        routePoint: RouteProjection
        obstaclePoint: RouteProjection
        score: number
      }
    | undefined
  for (
    let routeIndex = 0;
    routeIndex + 1 < route.route.length;
    routeIndex += 1
  ) {
    const routeStart = route.route[routeIndex]!
    const routeEnd = route.route[routeIndex + 1]!
    if (routeStart.z !== routeEnd.z) continue
    const routeDx = routeEnd.x - routeStart.x
    const routeDy = routeEnd.y - routeStart.y
    const routeLengthSquared = routeDx * routeDx + routeDy * routeDy
    if (routeLengthSquared <= 1e-8) continue
    const routeT = Math.max(
      0,
      Math.min(
        1,
        ((center.x - routeStart.x) * routeDx +
          (center.y - routeStart.y) * routeDy) /
          routeLengthSquared,
      ),
    )
    const routePoint = {
      x: routeStart.x + routeDx * routeT,
      y: routeStart.y + routeDy * routeT,
      z: routeStart.z,
    }

    for (
      let otherIndex = 0;
      otherIndex + 1 < otherRoute.route.length;
      otherIndex += 1
    ) {
      const otherStart = otherRoute.route[otherIndex]!
      const otherEnd = otherRoute.route[otherIndex + 1]!
      if (otherStart.z !== otherEnd.z || otherStart.z !== routeStart.z) continue
      const otherDx = otherEnd.x - otherStart.x
      const otherDy = otherEnd.y - otherStart.y
      const otherLengthSquared = otherDx * otherDx + otherDy * otherDy
      if (otherLengthSquared <= 1e-8) continue
      const otherT = Math.max(
        0,
        Math.min(
          1,
          ((center.x - otherStart.x) * otherDx +
            (center.y - otherStart.y) * otherDy) /
            otherLengthSquared,
        ),
      )
      const obstaclePoint = {
        x: otherStart.x + otherDx * otherT,
        y: otherStart.y + otherDy * otherT,
        z: otherStart.z,
      }
      const score =
        Math.hypot(routePoint.x - center.x, routePoint.y - center.y) +
        Math.hypot(obstaclePoint.x - center.x, obstaclePoint.y - center.y)
      if (!nearest || score < nearest.score) {
        nearest = { routePoint, obstaclePoint, score }
      }
    }
  }
  return nearest
}

const getLayerTransitionPoints = (
  routes: readonly HighDensityRoute[],
): Point[] => {
  const points: Point[] = []
  const keys = new Set<string>()
  for (const route of routes) {
    for (let index = 0; index + 1 < route.route.length; index += 1) {
      const current = route.route[index]!
      const next = route.route[index + 1]!
      if (
        current.z === next.z ||
        Math.hypot(current.x - next.x, current.y - next.y) > 1e-6
      ) {
        continue
      }
      const key = `${current.x.toFixed(6)}:${current.y.toFixed(6)}`
      if (keys.has(key)) continue
      keys.add(key)
      points.push({ x: current.x, y: current.y })
    }
  }
  return points
}

const getViaRouteIndexes = (
  routes: readonly HighDensityRoute[],
  center: Point,
): number[] => {
  const ownerNetKeys = new Set(
    routes.flatMap((route) =>
      route.vias.some(
        (via) => Math.hypot(via.x - center.x, via.y - center.y) <= 1e-6,
      )
        ? [route.rootConnectionName ?? route.connectionName]
        : [],
    ),
  )
  return routes.flatMap((route, routeIndex) =>
    ownerNetKeys.has(route.rootConnectionName ?? route.connectionName) &&
    route.route.some(
      (via) => Math.hypot(via.x - center.x, via.y - center.y) <= 1e-6,
    )
      ? [routeIndex]
      : [],
  )
}

const getPointToObstacleDistance = (
  point: Point,
  obstacle: RoutingObstacle,
): number => {
  const dx = Math.max(
    0,
    Math.abs(point.x - obstacle.center.x) - obstacle.width / 2,
  )
  const dy = Math.max(
    0,
    Math.abs(point.y - obstacle.center.y) - obstacle.height / 2,
  )
  return Math.hypot(dx, dy)
}

const getMoveData = (
  error: DrcError,
  center: Point,
  routeIndex: number,
  errorRouteIndexes: readonly number[],
  routes: readonly HighDensityRoute[],
  transitionPoints: readonly Point[],
  obstacles: readonly RoutingObstacle[],
): MoveData => {
  const route = routes[routeIndex]
  if (!route) return {}

  let routePoint: RouteProjection | undefined
  let obstaclePoint: RouteProjection | Point | undefined
  let pairedRouteIndex: number | undefined
  let pairScore = Number.POSITIVE_INFINITY
  for (const otherRouteIndex of errorRouteIndexes) {
    if (otherRouteIndex === routeIndex) continue
    const otherRoute = routes[otherRouteIndex]
    if (!otherRoute) continue
    const candidate = getNearestSameLayerProjectionPair(
      route,
      otherRoute,
      center,
    )
    if (candidate && candidate.score < pairScore) {
      routePoint = candidate.routePoint
      obstaclePoint = candidate.obstaclePoint
      pairedRouteIndex = otherRouteIndex
      pairScore = candidate.score
    }
  }

  routePoint ??= getNearestRouteProjection(route, center)
  if (!routePoint) return {}
  obstaclePoint ??= getDrcPointField(error, "pad_center")
  let routingObstacle: RoutingObstacle | undefined
  if (isTracePadOverlapError(error)) {
    const obstaclePortId = String(error.message).match(
      /pcb_port\[#(pcb_port_[^\]]+)\]/,
    )?.[1]
    routingObstacle = obstaclePortId
      ? obstacles
          .filter((candidate) =>
            candidate.connectedTo?.includes(obstaclePortId),
          )
          .sort(
            (a, b) =>
              getPointToObstacleDistance(center, a) -
                getPointToObstacleDistance(center, b) ||
              Math.hypot(center.x - a.center.x, center.y - a.center.y) -
                Math.hypot(center.x - b.center.x, center.y - b.center.y),
          )[0]
      : undefined
    if (!obstaclePoint && routingObstacle) {
      obstaclePoint = routingObstacle.center
    }
  }
  if (
    !obstaclePoint &&
    error.via_center &&
    typeof error.via_center === "object"
  ) {
    const viaCenter = error.via_center as Record<string, unknown>
    if (typeof viaCenter.x === "number" && typeof viaCenter.y === "number") {
      obstaclePoint = { x: viaCenter.x, y: viaCenter.y }
    }
  }
  if (
    !obstaclePoint &&
    (typeof error.pcb_via_id === "string" || isTraceViaOverlapError(error))
  ) {
    obstaclePoint = getNearestTransitionPoint(center, transitionPoints)
  }
  if (!obstaclePoint) return { sourceZ: routePoint.z }

  const dx = routePoint.x - obstaclePoint.x
  const dy = routePoint.y - obstaclePoint.y
  const length = Math.hypot(dx, dy)
  return {
    direction: length > 1e-6 ? { x: dx / length, y: dy / length } : undefined,
    otherRouteIndex: pairedRouteIndex,
    sourceZ: routePoint.z,
    obstacle: routingObstacle,
  }
}

const insertObstacleDetour = (
  routes: HighDensityRoute[],
  routeIndex: number,
  center: Point,
  obstacle: RoutingObstacle,
  strategy: ObstacleDetourStrategy,
  boardPolygon: readonly Point[],
  sourceZ?: number,
): boolean => {
  const route = routes[routeIndex]
  if (!route) return false

  let nearest:
    | { segmentIndex: number; distance: number; sourceZ: number }
    | undefined
  for (
    let segmentIndex = 0;
    segmentIndex + 1 < route.route.length;
    segmentIndex += 1
  ) {
    const start = route.route[segmentIndex]!
    const end = route.route[segmentIndex + 1]!
    if (
      start.z !== end.z ||
      (sourceZ !== undefined && start.z !== sourceZ) ||
      start.toNextSegmentType === "through_obstacle" ||
      start.insideJumperPad ||
      end.insideJumperPad
    ) {
      continue
    }
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared <= 1e-8) continue
    const t = Math.max(
      0,
      Math.min(
        1,
        ((center.x - start.x) * dx + (center.y - start.y) * dy) / lengthSquared,
      ),
    )
    const projected = { x: start.x + dx * t, y: start.y + dy * t }
    const distance = Math.hypot(center.x - projected.x, center.y - projected.y)
    if (!nearest || distance < nearest.distance) {
      nearest = { segmentIndex, distance, sourceZ: start.z }
    }
  }
  if (!nearest) return false

  const traceRadius = (route.traceThickness ?? 0.1) / 2
  const clearance = traceRadius + strategy.margin
  const minX = obstacle.center.x - obstacle.width / 2 - clearance
  const maxX = obstacle.center.x + obstacle.width / 2 + clearance
  const minY = obstacle.center.y - obstacle.height / 2 - clearance
  const maxY = obstacle.center.y + obstacle.height / 2 + clearance
  const isInsideExpandedObstacle = (point: Point): boolean =>
    point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY

  let beforeIndex = nearest.segmentIndex
  while (
    beforeIndex > 0 &&
    isInsideExpandedObstacle(route.route[beforeIndex]!)
  ) {
    beforeIndex -= 1
  }
  let afterIndex = nearest.segmentIndex + 1
  while (
    afterIndex + 1 < route.route.length &&
    isInsideExpandedObstacle(route.route[afterIndex]!)
  ) {
    afterIndex += 1
  }

  const before = route.route[beforeIndex]!
  const after = route.route[afterIndex]!
  if (
    isInsideExpandedObstacle(before) ||
    isInsideExpandedObstacle(after) ||
    before.z !== nearest.sourceZ ||
    after.z !== nearest.sourceZ
  ) {
    return false
  }
  const removedPoints = route.route.slice(beforeIndex + 1, afterIndex)
  if (
    removedPoints.some(
      (point) =>
        point.z !== nearest.sourceZ ||
        point.pcb_port_id ||
        point.insideJumperPad ||
        point.toNextSegmentType === "through_obstacle",
    ) ||
    route.vias.some((via) =>
      removedPoints.some(
        (point) => Math.hypot(via.x - point.x, via.y - point.y) <= 1e-6,
      ),
    )
  ) {
    return false
  }

  const boundaryPoints: Point[] =
    strategy.side === "top"
      ? [
          { x: before.x, y: maxY },
          { x: after.x, y: maxY },
        ]
      : strategy.side === "right"
        ? [
            { x: maxX, y: before.y },
            { x: maxX, y: after.y },
          ]
        : strategy.side === "bottom"
          ? [
              { x: before.x, y: minY },
              { x: after.x, y: minY },
            ]
          : [
              { x: minX, y: before.y },
              { x: minX, y: after.y },
            ]
  const doglegPoints = [before, ...boundaryPoints, after]
  if (!doesDoglegStayInsideBoard(doglegPoints, boardPolygon, traceRadius)) {
    return false
  }

  const {
    pcb_port_id: _pcbPortId,
    insideJumperPad: _insideJumperPad,
    toNextSegmentType: _toNextSegmentType,
    ...insertedPointFields
  } = before
  const replacement = boundaryPoints
    .map((point) => ({
      ...insertedPointFields,
      ...point,
      z: nearest.sourceZ,
    }))
    .filter(
      (point, index, points) =>
        Math.hypot(
          point.x - (index === 0 ? before : points[index - 1]!).x,
          point.y - (index === 0 ? before : points[index - 1]!).y,
        ) > 1e-6 &&
        (index + 1 < points.length ||
          Math.hypot(point.x - after.x, point.y - after.y) > 1e-6),
    )
  route.route.splice(
    beforeIndex + 1,
    afterIndex - beforeIndex - 1,
    ...replacement,
  )
  return replacement.length > 0
}

const insertDogleg = (
  routes: HighDensityRoute[],
  routeIndex: number,
  center: Point,
  strategy: DoglegStrategy,
  boardPolygon: readonly Point[],
  moveDirection?: Point,
  sourceZ?: number,
): boolean => {
  const route = routes[routeIndex]
  if (!route) return false
  let nearest:
    | { segmentIndex: number; t: number; distance: number; length: number }
    | undefined

  for (
    let segmentIndex = 0;
    segmentIndex + 1 < route.route.length;
    segmentIndex += 1
  ) {
    const start = route.route[segmentIndex]!
    const end = route.route[segmentIndex + 1]!
    if (
      start.z !== end.z ||
      (sourceZ !== undefined && start.z !== sourceZ) ||
      start.toNextSegmentType === "through_obstacle" ||
      start.insideJumperPad ||
      end.insideJumperPad
    ) {
      continue
    }
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared <= 1e-8) continue
    const t = Math.max(
      0,
      Math.min(
        1,
        ((center.x - start.x) * dx + (center.y - start.y) * dy) / lengthSquared,
      ),
    )
    const projectedPoint = { x: start.x + dx * t, y: start.y + dy * t }
    const distance = Math.hypot(
      center.x - projectedPoint.x,
      center.y - projectedPoint.y,
    )
    if (!nearest || distance < nearest.distance) {
      nearest = {
        segmentIndex,
        t,
        distance,
        length: Math.sqrt(lengthSquared),
      }
    }
  }
  if (!nearest) return false

  const start = route.route[nearest.segmentIndex]!
  const end = route.route[nearest.segmentIndex + 1]!
  const dx = end.x - start.x
  const dy = end.y - start.y
  const normalX = -dy / nearest.length
  const normalY = dx / nearest.length
  const offsetX = moveDirection
    ? moveDirection.x * Math.abs(strategy.offset)
    : normalX * strategy.offset
  const offsetY = moveDirection
    ? moveDirection.y * Math.abs(strategy.offset)
    : normalY * strategy.offset
  const halfSpanT = Math.min(0.45, strategy.span / nearest.length)
  const beforeT = Math.max(0.02, nearest.t - halfSpanT)
  const afterT = Math.min(0.98, nearest.t + halfSpanT)
  if (afterT - beforeT < 0.02) return false

  const beforePoint = {
    x: start.x + dx * beforeT + offsetX,
    y: start.y + dy * beforeT + offsetY,
  }
  const afterPoint = {
    x: start.x + dx * afterT + offsetX,
    y: start.y + dy * afterT + offsetY,
  }
  if (
    !doesDoglegStayInsideBoard(
      [start, beforePoint, afterPoint, end],
      boardPolygon,
      (route.traceThickness ?? 0.1) / 2,
    )
  ) {
    return false
  }

  const {
    pcb_port_id: _pcbPortId,
    insideJumperPad: _insideJumperPad,
    toNextSegmentType: _toNextSegmentType,
    ...insertedPointFields
  } = start
  route.route.splice(
    nearest.segmentIndex + 1,
    0,
    { ...insertedPointFields, ...beforePoint },
    { ...insertedPointFields, ...afterPoint },
  )
  return true
}

const shiftNearestSegment = (
  routes: HighDensityRoute[],
  routeIndex: number,
  center: Point,
  direction: Point,
  distance: number,
  boardPolygon: readonly Point[],
  sourceZ?: number,
): boolean => {
  const route = routes[routeIndex]
  if (!route) return false
  let nearest: { segmentIndex: number; distance: number } | undefined

  for (
    let segmentIndex = 0;
    segmentIndex + 1 < route.route.length;
    segmentIndex += 1
  ) {
    const start = route.route[segmentIndex]!
    const end = route.route[segmentIndex + 1]!
    if (
      start.z !== end.z ||
      (sourceZ !== undefined && start.z !== sourceZ) ||
      start.toNextSegmentType === "through_obstacle" ||
      start.insideJumperPad ||
      end.insideJumperPad
    ) {
      continue
    }
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared <= 1e-8) continue
    const t = Math.max(
      0,
      Math.min(
        1,
        ((center.x - start.x) * dx + (center.y - start.y) * dy) / lengthSquared,
      ),
    )
    const projected = { x: start.x + dx * t, y: start.y + dy * t }
    const candidateDistance = Math.hypot(
      center.x - projected.x,
      center.y - projected.y,
    )
    if (!nearest || candidateDistance < nearest.distance) {
      nearest = { segmentIndex, distance: candidateDistance }
    }
  }
  if (!nearest) return false

  const start = route.route[nearest.segmentIndex]!
  const end = route.route[nearest.segmentIndex + 1]!
  const matchesEndpoint = (point: Point): boolean =>
    Math.hypot(point.x - start.x, point.y - start.y) <= 1e-6 ||
    Math.hypot(point.x - end.x, point.y - end.y) <= 1e-6
  const pointIndexes = route.route.flatMap((point, pointIndex) =>
    matchesEndpoint(point) ? [pointIndex] : [],
  )
  if (
    pointIndexes.includes(0) ||
    pointIndexes.includes(route.route.length - 1) ||
    pointIndexes.some((pointIndex) => {
      const point = route.route[pointIndex]!
      return Boolean(point.pcb_port_id || point.insideJumperPad)
    })
  ) {
    return false
  }

  const offset = {
    x: direction.x * distance,
    y: direction.y * distance,
  }
  for (const pointIndex of pointIndexes) {
    const point = route.route[pointIndex]!
    point.x += offset.x
    point.y += offset.y
    if (
      !isPointInsideBoard(
        point,
        boardPolygon,
        (point.traceThickness ?? route.traceThickness ?? 0.1) / 2,
      )
    ) {
      return false
    }
  }
  for (const via of route.vias) {
    if (matchesEndpoint(via)) {
      via.x += offset.x
      via.y += offset.y
    }
  }

  const affectedSegments = new Set<number>()
  for (const pointIndex of pointIndexes) {
    if (pointIndex > 0) affectedSegments.add(pointIndex - 1)
    if (pointIndex + 1 < route.route.length) affectedSegments.add(pointIndex)
  }
  for (const segmentIndex of affectedSegments) {
    const segmentStart = route.route[segmentIndex]!
    const segmentEnd = route.route[segmentIndex + 1]!
    if (
      !doesDoglegStayInsideBoard(
        [segmentStart, segmentEnd],
        boardPolygon,
        (route.traceThickness ?? 0.1) / 2,
      )
    ) {
      return false
    }
  }
  return true
}

const shiftVia = (
  routes: HighDensityRoute[],
  viaRouteIndexes: readonly number[],
  center: Point,
  direction: Point,
  distance: number,
  boardPolygon: readonly Point[],
): boolean => {
  if (viaRouteIndexes.length === 0) return false
  const matchesVia = (point: Point): boolean =>
    Math.hypot(point.x - center.x, point.y - center.y) <= 1e-6
  const offset = {
    x: -direction.x * distance,
    y: -direction.y * distance,
  }
  let movedVia = false

  for (const routeIndex of viaRouteIndexes) {
    const route = routes[routeIndex]
    if (!route) return false
    const pointIndexes = route.route.flatMap((point, pointIndex) =>
      matchesVia(point) ? [pointIndex] : [],
    )
    const viaIndexes = route.vias.flatMap((via, viaIndex) =>
      matchesVia(via) ? [viaIndex] : [],
    )
    if (pointIndexes.length === 0) return false
    if (
      pointIndexes.some((pointIndex) => {
        const point = route.route[pointIndex]!
        return Boolean(point.pcb_port_id || point.insideJumperPad)
      })
    ) {
      return false
    }

    for (const pointIndex of pointIndexes) {
      const point = route.route[pointIndex]!
      point.x += offset.x
      point.y += offset.y
      if (
        !isPointInsideBoard(
          point,
          boardPolygon,
          Math.max(
            route.viaDiameter / 2,
            (point.traceThickness ?? route.traceThickness) / 2,
          ),
        )
      ) {
        return false
      }
    }
    for (const viaIndex of viaIndexes) {
      const via = route.vias[viaIndex]!
      via.x += offset.x
      via.y += offset.y
      movedVia = true
    }

    const affectedSegments = new Set<number>()
    for (const pointIndex of pointIndexes) {
      if (pointIndex > 0) affectedSegments.add(pointIndex - 1)
      if (pointIndex + 1 < route.route.length) affectedSegments.add(pointIndex)
    }
    for (const segmentIndex of affectedSegments) {
      const segmentStart = route.route[segmentIndex]!
      const segmentEnd = route.route[segmentIndex + 1]!
      if (
        !doesDoglegStayInsideBoard(
          [segmentStart, segmentEnd],
          boardPolygon,
          route.traceThickness / 2,
        )
      ) {
        return false
      }
    }
  }

  return movedVia
}

const snapRouteTerminal = (
  routes: HighDensityRoute[],
  routeIndex: number,
  errorCenter: Point,
  terminalPoint: Point,
  terminalPortId: string | undefined,
  boardPolygon: readonly Point[],
): boolean => {
  const route = routes[routeIndex]
  if (!route || route.route.length < 2) return false
  const endpointIndexes = [0, route.route.length - 1]
  let pointIndex = terminalPortId
    ? endpointIndexes.find(
        (candidateIndex) =>
          route.route[candidateIndex]!.pcb_port_id === terminalPortId,
      )
    : undefined
  if (pointIndex === undefined) {
    pointIndex = endpointIndexes.reduce((nearestIndex, candidateIndex) => {
      const nearest = route.route[nearestIndex]!
      const candidate = route.route[candidateIndex]!
      return Math.hypot(
        candidate.x - errorCenter.x,
        candidate.y - errorCenter.y,
      ) < Math.hypot(nearest.x - errorCenter.x, nearest.y - errorCenter.y)
        ? candidateIndex
        : nearestIndex
    })
    const nearestEndpoint = route.route[pointIndex]!
    if (
      Math.hypot(
        nearestEndpoint.x - errorCenter.x,
        nearestEndpoint.y - errorCenter.y,
      ) > 1e-3
    ) {
      return false
    }
  }

  const terminal = route.route[pointIndex]!
  if (
    Math.hypot(terminal.x - terminalPoint.x, terminal.y - terminalPoint.y) <=
    1e-6
  ) {
    return false
  }
  terminal.x = terminalPoint.x
  terminal.y = terminalPoint.y
  if (terminalPortId) terminal.pcb_port_id = terminalPortId
  const neighbor = route.route[pointIndex === 0 ? 1 : pointIndex - 1]!
  const traceRadius = (terminal.traceThickness ?? route.traceThickness) / 2
  return (
    isPointInsideBoard(terminal, boardPolygon, traceRadius) &&
    doesDoglegStayInsideBoard(
      pointIndex === 0 ? [terminal, neighbor] : [neighbor, terminal],
      boardPolygon,
      traceRadius,
    )
  )
}

const insertSegmentLayerDetour = (
  routes: HighDensityRoute[],
  routeIndex: number,
  center: Point,
  strategy: LayerDetourStrategy,
  sourceZ?: number,
): boolean => {
  const route = routes[routeIndex]
  if (!route) return false
  let nearest:
    | { segmentIndex: number; t: number; distance: number; length: number }
    | undefined
  for (
    let segmentIndex = 0;
    segmentIndex + 1 < route.route.length;
    segmentIndex += 1
  ) {
    const start = route.route[segmentIndex]!
    const end = route.route[segmentIndex + 1]!
    if (
      start.z !== end.z ||
      (sourceZ !== undefined && start.z !== sourceZ) ||
      start.z === strategy.targetZ ||
      start.toNextSegmentType === "through_obstacle" ||
      start.insideJumperPad ||
      end.insideJumperPad
    ) {
      continue
    }
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared <= 1e-8) continue
    const t = Math.max(
      0,
      Math.min(
        1,
        ((center.x - start.x) * dx + (center.y - start.y) * dy) / lengthSquared,
      ),
    )
    const projected = { x: start.x + dx * t, y: start.y + dy * t }
    const distance = Math.hypot(center.x - projected.x, center.y - projected.y)
    if (!nearest || distance < nearest.distance) {
      nearest = {
        segmentIndex,
        t,
        distance,
        length: Math.sqrt(lengthSquared),
      }
    }
  }
  if (!nearest) return false

  const start = route.route[nearest.segmentIndex]!
  const end = route.route[nearest.segmentIndex + 1]!
  const dx = end.x - start.x
  const dy = end.y - start.y
  const halfSpanT = Math.min(0.48, strategy.span / nearest.length)
  const beforeT = Math.max(0.01, nearest.t - halfSpanT)
  const afterT = Math.min(0.99, nearest.t + halfSpanT)
  if (afterT - beforeT < 0.02) return false
  const {
    pcb_port_id: _pcbPortId,
    insideJumperPad: _insideJumperPad,
    toNextSegmentType: _toNextSegmentType,
    ...pointFields
  } = start
  const beforePoint = {
    ...pointFields,
    x: start.x + dx * beforeT,
    y: start.y + dy * beforeT,
  }
  const afterPoint = {
    ...pointFields,
    x: start.x + dx * afterT,
    y: start.y + dy * afterT,
  }
  route.route.splice(
    nearest.segmentIndex + 1,
    0,
    beforePoint,
    { ...beforePoint, z: strategy.targetZ },
    { ...afterPoint, z: strategy.targetZ },
    afterPoint,
  )
  return true
}

const insertRouteLayerDetour = (
  routes: HighDensityRoute[],
  routeIndex: number,
  center: Point,
  strategy: LayerDetourStrategy,
  sourceZ?: number,
): boolean => {
  const route = routes[routeIndex]
  if (!route) return false
  let nearest:
    | { segmentIndex: number; t: number; distance: number; length: number }
    | undefined

  for (
    let segmentIndex = 0;
    segmentIndex + 1 < route.route.length;
    segmentIndex += 1
  ) {
    const start = route.route[segmentIndex]!
    const end = route.route[segmentIndex + 1]!
    if (
      start.z !== end.z ||
      (sourceZ !== undefined && start.z !== sourceZ) ||
      start.z === strategy.targetZ ||
      start.toNextSegmentType === "through_obstacle" ||
      start.insideJumperPad ||
      end.insideJumperPad
    ) {
      continue
    }
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared <= 1e-8) continue
    const t = Math.max(
      0,
      Math.min(
        1,
        ((center.x - start.x) * dx + (center.y - start.y) * dy) / lengthSquared,
      ),
    )
    const projectedPoint = { x: start.x + dx * t, y: start.y + dy * t }
    const distance = Math.hypot(
      center.x - projectedPoint.x,
      center.y - projectedPoint.y,
    )
    if (!nearest || distance < nearest.distance) {
      nearest = {
        segmentIndex,
        t,
        distance,
        length: Math.sqrt(lengthSquared),
      }
    }
  }
  if (!nearest) return false

  const selectedSourceZ = route.route[nearest.segmentIndex]!.z
  let beforeSegmentIndex = nearest.segmentIndex
  let beforeT = nearest.t
  let remainingBefore = strategy.span
  while (remainingBefore > 1e-9) {
    const start = route.route[beforeSegmentIndex]
    const end = route.route[beforeSegmentIndex + 1]
    if (
      !start ||
      !end ||
      start.z !== selectedSourceZ ||
      end.z !== selectedSourceZ
    ) {
      return false
    }
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y)
    if (segmentLength <= 1e-8) return false
    const available = beforeT * segmentLength
    if (remainingBefore <= available) {
      beforeT -= remainingBefore / segmentLength
      remainingBefore = 0
      break
    }
    remainingBefore -= available
    beforeSegmentIndex -= 1
    if (beforeSegmentIndex < 0) {
      if (!route.route[0]?.pcb_port_id) return false
      beforeSegmentIndex = 0
      beforeT = 0
      remainingBefore = 0
      break
    }
    beforeT = 1
  }

  let afterSegmentIndex = nearest.segmentIndex
  let afterT = nearest.t
  let remainingAfter = strategy.span
  while (remainingAfter > 1e-9) {
    const start = route.route[afterSegmentIndex]
    const end = route.route[afterSegmentIndex + 1]
    if (
      !start ||
      !end ||
      start.z !== selectedSourceZ ||
      end.z !== selectedSourceZ
    ) {
      return false
    }
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y)
    if (segmentLength <= 1e-8) return false
    const available = (1 - afterT) * segmentLength
    if (remainingAfter <= available) {
      afterT += remainingAfter / segmentLength
      remainingAfter = 0
      break
    }
    remainingAfter -= available
    afterSegmentIndex += 1
    if (afterSegmentIndex + 1 >= route.route.length) {
      if (!route.route.at(-1)?.pcb_port_id) return false
      afterSegmentIndex = route.route.length - 2
      afterT = 1
      remainingAfter = 0
      break
    }
    afterT = 0
  }

  const interiorPoints = route.route.slice(
    beforeSegmentIndex + 1,
    afterSegmentIndex + 1,
  )
  if (
    interiorPoints.some(
      (point) =>
        point.z !== selectedSourceZ ||
        point.pcb_port_id ||
        point.insideJumperPad ||
        point.toNextSegmentType === "through_obstacle",
    )
  ) {
    return false
  }

  const interpolatePoint = (segmentIndex: number, t: number) => {
    const start = route.route[segmentIndex]!
    const end = route.route[segmentIndex + 1]!
    const {
      pcb_port_id: _pcbPortId,
      insideJumperPad: _insideJumperPad,
      toNextSegmentType: _toNextSegmentType,
      ...pointFields
    } = start
    return {
      ...pointFields,
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      z: selectedSourceZ,
    }
  }
  const beforePoint = interpolatePoint(beforeSegmentIndex, beforeT)
  const afterPoint = interpolatePoint(afterSegmentIndex, afterT)
  if (
    Math.hypot(afterPoint.x - beforePoint.x, afterPoint.y - beforePoint.y) <
    0.02
  ) {
    return false
  }

  const replacement = [
    beforePoint,
    { ...beforePoint, z: strategy.targetZ },
    ...interiorPoints.map((point) => ({
      ...point,
      z: strategy.targetZ,
      pcb_port_id: undefined,
      insideJumperPad: undefined,
      toNextSegmentType: undefined,
    })),
    { ...afterPoint, z: strategy.targetZ },
    afterPoint,
  ]
  const prefixPoint = route.route[beforeSegmentIndex]!
  if (
    prefixPoint.x === replacement[0]!.x &&
    prefixPoint.y === replacement[0]!.y &&
    prefixPoint.z === replacement[0]!.z
  ) {
    replacement.shift()
  }
  const suffixPoint = route.route[afterSegmentIndex + 1]!
  if (
    suffixPoint.x === replacement.at(-1)!.x &&
    suffixPoint.y === replacement.at(-1)!.y &&
    suffixPoint.z === replacement.at(-1)!.z
  ) {
    replacement.pop()
  }
  const dedupedReplacement = replacement.filter(
    (point, index, points) =>
      index === 0 ||
      point.x !== points[index - 1]!.x ||
      point.y !== points[index - 1]!.y ||
      point.z !== points[index - 1]!.z,
  )
  route.route.splice(
    beforeSegmentIndex + 1,
    afterSegmentIndex - beforeSegmentIndex,
    ...dedupedReplacement,
  )
  return true
}

/**
 * Searches bounded local doglegs and layer detours around residual,
 * location-aware DRC errors. Every candidate is validated against the complete
 * DRC snapshot and accepted only when issue count or severity strictly
 * improves.
 */
export class ResidualLocalRerouteSolver extends BaseSolver {
  private readonly inputHdRoutes: readonly HighDensityRoute[]
  private readonly boardPolygon: readonly Point[]
  private readonly strategies: readonly CandidateStrategy[]
  private bestRoutes: HighDensityRoute[]
  private bestSnapshot?: DrcSnapshot
  private bestCandidateSnapshot?: DrcSnapshot
  private initialIssueCount = Number.POSITIVE_INFINITY
  private candidatePlan: CandidatePlanEntry[] = []
  private candidatePlanIndex = 0
  private candidateAttempts = 0
  private acceptedMoves = 0
  private acceptedCountReducingMoves = 0
  private acceptedRefinementMoves = 0
  private sweepsStarted = 0
  private currentTargetCount = 0
  private readonly attemptedCandidateKeys = new Set<string>()
  private readonly routeRevisionByIndex: number[]
  private readonly maxCandidateAttempts: number
  private readonly maxAcceptedMoves: number
  private readonly maxCandidatesBeforeRefinement: number
  private readonly maxCandidatesWithoutCountReduction: number
  private readonly maxTotalAcceptedMoves: number
  private candidateAttemptsSinceAccepted = 0
  private candidateAttemptsSinceCountReduction = 0
  private candidateDrcEvaluations = 0
  private validationDrcEvaluations = 0
  private pendingCandidate?: {
    routes: HighDensityRoute[]
    snapshot: DrcSnapshot
    candidateSnapshot: DrcSnapshot
    entry: CandidatePlanEntry
  }

  constructor(private readonly config: ResidualLocalRerouteSolverConfig) {
    super()
    if (!Number.isFinite(config.effort) || config.effort <= 0) {
      throw new Error("effort must be a positive finite number")
    }
    if (!Number.isInteger(config.layerCount) || config.layerCount < 1) {
      throw new Error("layerCount must be a positive integer")
    }
    this.inputHdRoutes = config.hdRoutes
    this.bestRoutes = config.hdRoutes.map((route) => structuredClone(route))
    this.maxCandidateAttempts = Math.min(
      768,
      Math.max(1, Math.ceil(96 * config.effort)),
    )
    this.maxAcceptedMoves = Math.min(
      16,
      Math.max(1, Math.ceil(2 * config.effort)),
    )
    this.routeRevisionByIndex = config.hdRoutes.map(() => 0)
    this.boardPolygon = getBoardPolygon(config.bounds, config.outline)
    this.maxCandidatesBeforeRefinement = Math.max(
      8,
      Math.floor(
        this.maxCandidateAttempts / Math.max(1, this.maxAcceptedMoves),
      ),
    )
    this.maxCandidatesWithoutCountReduction = Math.min(
      this.maxCandidateAttempts,
      128,
      Math.max(32, Math.ceil(20 * Math.log2(Math.max(2, config.effort)))),
    )
    const extraAcceptedMoveAllowance = Math.min(
      4,
      Math.max(0, Math.ceil(Math.log2(config.effort))),
    )
    this.maxTotalAcceptedMoves =
      this.maxAcceptedMoves + extraAcceptedMoveAllowance
    const strategyLimit = Math.min(
      ALL_DOGLEG_STRATEGIES.length,
      2 + Math.ceil(4.5 * Math.log2(Math.max(1, config.effort))),
    )
    const layerDetourStrategies: CandidateStrategy[] = Array.from(
      { length: config.layerCount },
      (_, targetZ) => targetZ,
    ).flatMap((targetZ) =>
      LAYER_DETOUR_SPANS.flatMap((span) =>
        (["segment", "route"] as const).map((scope) => ({
          type: "layer_detour" as const,
          scope,
          targetZ,
          span,
        })),
      ),
    )
    const doglegStrategies: CandidateStrategy[] = ALL_DOGLEG_STRATEGIES.slice(
      0,
      strategyLimit,
    ).map((strategy) => ({ type: "dogleg", ...strategy }))
    const directedDoglegStrategies: CandidateStrategy[] =
      DIRECTED_DOGLEG_STRATEGIES.map((strategy) => ({
        type: "directed_dogleg",
        ...strategy,
      }))
    const directedPairDoglegStrategies: CandidateStrategy[] =
      DIRECTED_DOGLEG_STRATEGIES.map((strategy) => ({
        type: "directed_pair_dogleg",
        ...strategy,
      }))
    const directedSegmentShiftStrategies: CandidateStrategy[] =
      DIRECTED_SEGMENT_SHIFT_STRATEGIES.map((strategy) => ({
        type: "directed_segment_shift",
        ...strategy,
      }))
    const directedPairShiftStrategies: CandidateStrategy[] =
      DIRECTED_SEGMENT_SHIFT_STRATEGIES.map((strategy) => ({
        type: "directed_pair_shift",
        ...strategy,
      }))
    const directedViaShiftStrategies: CandidateStrategy[] =
      DIRECTED_SEGMENT_SHIFT_STRATEGIES.map((strategy) => ({
        type: "directed_via_shift",
        ...strategy,
      }))
    const obstacleDetourMargins = config.effort > 1 ? [0.1] : []
    const obstacleDetourStrategies: CandidateStrategy[] =
      obstacleDetourMargins.flatMap((margin) =>
        (["top", "right", "bottom", "left"] as const).map((side) => ({
          type: "obstacle_detour" as const,
          side,
          margin,
        })),
      )
    this.strategies = [
      { type: "terminal_snap" },
      ...directedViaShiftStrategies,
      ...obstacleDetourStrategies,
      ...layerDetourStrategies,
      ...directedPairShiftStrategies,
      ...directedPairDoglegStrategies,
      ...directedSegmentShiftStrategies,
      ...directedDoglegStrategies,
      ...doglegStrategies,
    ]
    this.MAX_ITERATIONS =
      this.maxCandidateAttempts + this.maxTotalAcceptedMoves + 10
  }

  override getSolverName(): string {
    return "ResidualLocalRerouteSolver"
  }

  override getConstructorParams(): readonly [ResidualLocalRerouteSolverConfig] {
    return [
      {
        ...this.config,
        hdRoutes: this.inputHdRoutes,
      },
    ] as const
  }

  getOutput(): HighDensityRoute[] {
    return this.bestRoutes
  }

  private evaluate(
    routes: HighDensityRoute[],
    evaluator: DrcEvaluator,
  ): DrcSnapshot {
    const result = evaluator({
      traces: [],
      routes,
      hdRoutes: routes,
    })
    const rawErrors = Array.isArray(result) ? result : result.errors
    const errorsWithCenters = Array.isArray(result)
      ? result
      : (result.errorsWithCenters ?? result.errors)
    return {
      errors: errorsWithCenters,
      issueCount: rawErrors.length,
      issueScore: rawErrors.reduce(
        (score, error) => score + getDrcErrorSeverity(error),
        0,
      ),
    }
  }

  private evaluateCandidate(routes: HighDensityRoute[]): DrcSnapshot {
    this.candidateDrcEvaluations += 1
    return this.evaluate(
      routes,
      this.config.candidateDrcEvaluator ?? this.config.drcEvaluator,
    )
  }

  private evaluateValidation(routes: HighDensityRoute[]): DrcSnapshot {
    this.validationDrcEvaluations += 1
    return this.evaluate(routes, this.config.drcEvaluator)
  }

  private buildCandidatePlan(): void {
    const snapshot = this.bestSnapshot
    if (!snapshot) {
      throw new Error("Cannot build reroute plan before DRC evaluation")
    }
    const routeIndexByTraceId = getTraceRouteIndexById(this.bestRoutes)
    const targets: CandidateTarget[] = []
    const targetKeys = new Set<string>()
    const transitionPoints = getLayerTransitionPoints(this.bestRoutes)

    snapshot.errors.forEach((error) => {
      if (!SUPPORTED_ERROR_TYPES.has(String(error.type))) return
      const errorCenter = getErrorCenter(error)
      if (!errorCenter) return
      const routeIndexes = getTraceIdsForError(error)
        .map((traceId) => routeIndexByTraceId.get(traceId))
        .filter((routeIndex): routeIndex is number => routeIndex !== undefined)
      const typedViaCenter =
        error.type === "pcb_via_trace_clearance_error" &&
        error.via_center &&
        typeof error.via_center === "object" &&
        typeof (error.via_center as Record<string, unknown>).x === "number" &&
        typeof (error.via_center as Record<string, unknown>).y === "number"
          ? {
              x: (error.via_center as { x: number }).x,
              y: (error.via_center as { y: number }).y,
            }
          : undefined
      const viaCenter =
        typedViaCenter ??
        (isTraceViaOverlapError(error)
          ? getNearestTransitionPoint(errorCenter, transitionPoints)
          : undefined)
      const terminalPortId =
        typeof error.message === "string" &&
        error.message.includes("missing a connection")
          ? error.message.match(
              /(?:smtpad|plated_hole)\[#(pcb_port_[^\]]+)\]/,
            )?.[1]
          : undefined
      const terminalPoint = terminalPortId
        ? getDrcPointField(error, "pad_center")
        : undefined
      const padCenter = getDrcPointField(error, "pad_center")
      // Typed clearance reporters can attach a generic center that is far
      // from the colliding copper. Exact pad/via centers identify the local
      // route segment that must actually move. Trace overlap and connectivity
      // reporters already provide their useful collision/endpoint location.
      const center =
        error.type === "pcb_pad_trace_clearance_error"
          ? (padCenter ?? errorCenter)
          : error.type === "pcb_via_trace_clearance_error"
            ? (viaCenter ?? errorCenter)
            : errorCenter
      for (const routeIndex of new Set(routeIndexes)) {
        const targetKey = `${routeIndex}:${center.x.toFixed(4)}:${center.y.toFixed(4)}`
        if (targetKeys.has(targetKey)) continue
        targetKeys.add(targetKey)
        const moveData = getMoveData(
          error,
          center,
          routeIndex,
          routeIndexes,
          this.bestRoutes,
          transitionPoints,
          this.config.obstacles ?? [],
        )
        targets.push({
          routeIndex,
          center,
          severity: getDrcErrorSeverity(error),
          errorType: String(error.type),
          moveDirection: moveData.direction,
          otherRouteIndex: moveData.otherRouteIndex,
          sourceZ: moveData.sourceZ,
          viaCenter,
          viaRouteIndexes: viaCenter
            ? getViaRouteIndexes(this.bestRoutes, viaCenter)
            : undefined,
          terminalPoint,
          terminalPortId,
          obstacle: moveData.obstacle,
        })
      }
    })

    targets.sort((a, b) => a.severity - b.severity)

    // Breadth-first ordering gives every distinct violation one useful attempt
    // before spending more of the bounded budget on variants of an early
    // error. This matters on large boards where a full strategy sweep is much
    // larger than maxCandidateAttempts.
    const plan = this.strategies
      .flatMap((strategy) =>
        targets.flatMap((target) => {
          if (strategy.type === "terminal_snap" && !target.terminalPoint) {
            return []
          }
          if (strategy.type === "obstacle_detour" && !target.obstacle) {
            return []
          }
          if (
            (strategy.type === "obstacle_detour" ||
              strategy.type === "directed_pair_dogleg") &&
            this.initialIssueCount > 2
          ) {
            return []
          }
          if (
            (strategy.type === "directed_dogleg" ||
              strategy.type === "directed_pair_dogleg" ||
              strategy.type === "directed_segment_shift" ||
              strategy.type === "directed_pair_shift" ||
              strategy.type === "directed_via_shift") &&
            !target.moveDirection
          ) {
            return []
          }
          if (
            strategy.type === "directed_via_shift" &&
            (!target.viaCenter || target.viaRouteIndexes?.length === 0)
          ) {
            return []
          }
          if (
            (strategy.type === "directed_pair_shift" ||
              strategy.type === "directed_pair_dogleg") &&
            (target.otherRouteIndex === undefined ||
              target.routeIndex > target.otherRouteIndex)
          ) {
            return []
          }
          const affectedRouteIndexes =
            strategy.type === "directed_via_shift"
              ? (target.viaRouteIndexes ?? [])
              : (strategy.type === "directed_pair_shift" ||
                    strategy.type === "directed_pair_dogleg") &&
                  target.otherRouteIndex !== undefined
                ? [target.routeIndex, target.otherRouteIndex]
                : [target.routeIndex]
          const routeRevisions = affectedRouteIndexes
            .map(
              (routeIndex) =>
                `${routeIndex}:${this.routeRevisionByIndex[routeIndex] ?? 0}`,
            )
            .join(",")
          const key = `${routeRevisions}:${target.center.x.toFixed(4)}:${target.center.y.toFixed(4)}:${getCandidateStrategyKey(strategy)}`
          return this.attemptedCandidateKeys.has(key)
            ? []
            : [{ ...target, ...strategy, key }]
        }),
      )
      .sort(
        (a, b) =>
          getCandidatePriority(a, a) - getCandidatePriority(b, b) ||
          getCandidateStrategyVariantRank(a, a) -
            getCandidateStrategyVariantRank(b, b) ||
          a.severity - b.severity,
      )

    this.candidatePlan = plan
    this.candidatePlanIndex = 0
    this.currentTargetCount = targets.length
    this.sweepsStarted += 1
  }

  private finish(params: {
    stoppedAfterNoImprovement: boolean
    stoppedAfterCountPlateau?: boolean
    hitCandidateLimit?: boolean
    hitAcceptedMoveLimit?: boolean
  }): void {
    this.stats = {
      residualLocalRerouteInitialDrcIssueCount:
        this.stats.residualLocalRerouteInitialDrcIssueCount,
      residualLocalRerouteFinalDrcIssueCount: this.bestSnapshot?.issueCount,
      residualLocalRerouteFinalDrcIssueScore: this.bestSnapshot?.issueScore,
      residualLocalRerouteCandidateAttempts: this.candidateAttempts,
      residualLocalRerouteAcceptedMoves: this.acceptedMoves,
      residualLocalRerouteAcceptedCountReducingMoves:
        this.acceptedCountReducingMoves,
      residualLocalRerouteAcceptedRefinementMoves: this.acceptedRefinementMoves,
      residualLocalRerouteSweepsStarted: this.sweepsStarted,
      residualLocalRerouteStrategyCount: this.strategies.length,
      residualLocalRerouteTargetCount: this.currentTargetCount,
      residualLocalRerouteUniqueCandidatesVisited:
        this.attemptedCandidateKeys.size,
      residualLocalRerouteStoppedAfterNoImprovement:
        params.stoppedAfterNoImprovement,
      residualLocalRerouteStoppedAfterCountPlateau:
        params.stoppedAfterCountPlateau ?? false,
      residualLocalRerouteHitCandidateLimit: params.hitCandidateLimit ?? false,
      residualLocalRerouteHitAcceptedMoveLimit:
        params.hitAcceptedMoveLimit ?? false,
      residualLocalRerouteMaxCandidateAttempts:
        this.maxCandidateAttempts,
      residualLocalRerouteMaxAcceptedMoves: this.maxAcceptedMoves,
      residualLocalRerouteMaxTotalAcceptedMoves: this.maxTotalAcceptedMoves,
      residualLocalRerouteMaxCandidatesWithoutCountReduction:
        this.maxCandidatesWithoutCountReduction,
      residualLocalRerouteCandidateDrcEvaluations: this.candidateDrcEvaluations,
      residualLocalRerouteValidationDrcEvaluations:
        this.validationDrcEvaluations,
    }
    this.progress = 1
    this.solved = true
  }

  private createCandidateRoutes(
    candidatePlanEntry: CandidatePlanEntry,
  ): HighDensityRoute[] | undefined {
    const affectedRouteIndexes =
      candidatePlanEntry.type === "directed_via_shift"
        ? (candidatePlanEntry.viaRouteIndexes ?? [])
        : (candidatePlanEntry.type === "directed_pair_shift" ||
              candidatePlanEntry.type === "directed_pair_dogleg") &&
            candidatePlanEntry.otherRouteIndex !== undefined
          ? [candidatePlanEntry.routeIndex, candidatePlanEntry.otherRouteIndex]
          : [candidatePlanEntry.routeIndex]
    const candidateRoutes = [...this.bestRoutes]
    for (const routeIndex of new Set(affectedRouteIndexes)) {
      const route = this.bestRoutes[routeIndex]
      if (!route) {
        throw new Error(`Missing candidate route at index ${routeIndex}`)
      }
      candidateRoutes[routeIndex] = structuredClone(route)
    }
    let changed = false
    if (
      candidatePlanEntry.type === "terminal_snap" &&
      candidatePlanEntry.terminalPoint
    ) {
      changed = snapRouteTerminal(
        candidateRoutes,
        candidatePlanEntry.routeIndex,
        candidatePlanEntry.center,
        candidatePlanEntry.terminalPoint,
        candidatePlanEntry.terminalPortId,
        this.boardPolygon,
      )
    } else if (
      candidatePlanEntry.type === "obstacle_detour" &&
      candidatePlanEntry.obstacle
    ) {
      changed = insertObstacleDetour(
        candidateRoutes,
        candidatePlanEntry.routeIndex,
        candidatePlanEntry.center,
        candidatePlanEntry.obstacle,
        candidatePlanEntry,
        this.boardPolygon,
        candidatePlanEntry.sourceZ,
      )
    } else if (
      candidatePlanEntry.type === "directed_via_shift" &&
      candidatePlanEntry.moveDirection &&
      candidatePlanEntry.viaCenter &&
      candidatePlanEntry.viaRouteIndexes
    ) {
      changed = shiftVia(
        candidateRoutes,
        candidatePlanEntry.viaRouteIndexes,
        candidatePlanEntry.viaCenter,
        candidatePlanEntry.moveDirection,
        candidatePlanEntry.distance,
        this.boardPolygon,
      )
    } else if (candidatePlanEntry.type === "layer_detour") {
      changed =
        candidatePlanEntry.scope === "segment"
          ? insertSegmentLayerDetour(
              candidateRoutes,
              candidatePlanEntry.routeIndex,
              candidatePlanEntry.center,
              candidatePlanEntry,
              candidatePlanEntry.sourceZ,
            )
          : insertRouteLayerDetour(
              candidateRoutes,
              candidatePlanEntry.routeIndex,
              candidatePlanEntry.center,
              candidatePlanEntry,
              candidatePlanEntry.sourceZ,
            )
    } else if (
      candidatePlanEntry.type === "directed_pair_shift" &&
      candidatePlanEntry.moveDirection &&
      candidatePlanEntry.otherRouteIndex !== undefined
    ) {
      const halfDistance = candidatePlanEntry.distance / 2
      const movedPrimary = shiftNearestSegment(
        candidateRoutes,
        candidatePlanEntry.routeIndex,
        candidatePlanEntry.center,
        candidatePlanEntry.moveDirection,
        halfDistance,
        this.boardPolygon,
        candidatePlanEntry.sourceZ,
      )
      const movedOther = shiftNearestSegment(
        candidateRoutes,
        candidatePlanEntry.otherRouteIndex,
        candidatePlanEntry.center,
        {
          x: -candidatePlanEntry.moveDirection.x,
          y: -candidatePlanEntry.moveDirection.y,
        },
        halfDistance,
        this.boardPolygon,
        candidatePlanEntry.sourceZ,
      )
      changed = movedPrimary && movedOther
    } else if (
      candidatePlanEntry.type === "directed_pair_dogleg" &&
      candidatePlanEntry.moveDirection &&
      candidatePlanEntry.otherRouteIndex !== undefined
    ) {
      const halfDistance = candidatePlanEntry.distance / 2
      const movedPrimary = insertDogleg(
        candidateRoutes,
        candidatePlanEntry.routeIndex,
        candidatePlanEntry.center,
        { offset: halfDistance, span: candidatePlanEntry.span },
        this.boardPolygon,
        candidatePlanEntry.moveDirection,
        candidatePlanEntry.sourceZ,
      )
      const movedOther = insertDogleg(
        candidateRoutes,
        candidatePlanEntry.otherRouteIndex,
        candidatePlanEntry.center,
        { offset: halfDistance, span: candidatePlanEntry.span },
        this.boardPolygon,
        {
          x: -candidatePlanEntry.moveDirection.x,
          y: -candidatePlanEntry.moveDirection.y,
        },
        candidatePlanEntry.sourceZ,
      )
      changed = movedPrimary && movedOther
    } else if (
      candidatePlanEntry.type === "directed_segment_shift" &&
      candidatePlanEntry.moveDirection
    ) {
      changed = shiftNearestSegment(
        candidateRoutes,
        candidatePlanEntry.routeIndex,
        candidatePlanEntry.center,
        candidatePlanEntry.moveDirection,
        candidatePlanEntry.distance,
        this.boardPolygon,
        candidatePlanEntry.sourceZ,
      )
    } else if (
      candidatePlanEntry.type === "directed_dogleg" ||
      candidatePlanEntry.type === "dogleg"
    ) {
      changed = insertDogleg(
        candidateRoutes,
        candidatePlanEntry.routeIndex,
        candidatePlanEntry.center,
        candidatePlanEntry.type === "directed_dogleg"
          ? {
              offset: candidatePlanEntry.distance,
              span: candidatePlanEntry.span,
            }
          : candidatePlanEntry,
        this.boardPolygon,
        candidatePlanEntry.type === "directed_dogleg"
          ? candidatePlanEntry.moveDirection
          : undefined,
        candidatePlanEntry.sourceZ,
      )
    }
    return changed ? candidateRoutes : undefined
  }

  private acceptCandidate(candidate: {
    routes: HighDensityRoute[]
    snapshot: DrcSnapshot
    candidateSnapshot: DrcSnapshot
    entry: CandidatePlanEntry
  }): boolean {
    const reducedIssueCount =
      candidate.snapshot.issueCount <
      (this.bestSnapshot?.issueCount ?? Infinity)
    this.bestRoutes = candidate.routes
    this.bestSnapshot = candidate.snapshot
    this.bestCandidateSnapshot = candidate.candidateSnapshot
    this.acceptedMoves += 1
    if (reducedIssueCount) {
      this.acceptedCountReducingMoves += 1
      this.candidateAttemptsSinceCountReduction = 0
    } else {
      this.acceptedRefinementMoves += 1
    }
    this.candidateAttemptsSinceAccepted = 0
    this.pendingCandidate = undefined
    const changedRouteIndexes =
      candidate.entry.type === "directed_via_shift"
        ? (candidate.entry.viaRouteIndexes ?? [])
        : [candidate.entry.routeIndex]
    for (const routeIndex of changedRouteIndexes) {
      this.routeRevisionByIndex[routeIndex] =
        (this.routeRevisionByIndex[routeIndex] ?? 0) + 1
    }
    if (
      (candidate.entry.type === "directed_pair_shift" ||
        candidate.entry.type === "directed_pair_dogleg") &&
      candidate.entry.otherRouteIndex !== undefined
    ) {
      this.routeRevisionByIndex[candidate.entry.otherRouteIndex] =
        (this.routeRevisionByIndex[candidate.entry.otherRouteIndex] ?? 0) + 1
    }
    if (candidate.snapshot.issueCount === 0) {
      this.finish({ stoppedAfterNoImprovement: false })
      return true
    }
    if (
      this.acceptedCountReducingMoves >= this.maxAcceptedMoves ||
      this.acceptedMoves >= this.maxTotalAcceptedMoves
    ) {
      this.finish({
        stoppedAfterNoImprovement: false,
        hitAcceptedMoveLimit: true,
      })
      return true
    }
    this.buildCandidatePlan()
    return false
  }

  _step(): void {
    if (!this.bestSnapshot) {
      this.bestSnapshot = this.evaluateValidation(this.bestRoutes)
      this.bestCandidateSnapshot = this.config.candidateDrcEvaluator
        ? this.evaluateCandidate(this.bestRoutes)
        : this.bestSnapshot
      this.initialIssueCount = this.bestSnapshot.issueCount
      this.stats.residualLocalRerouteInitialDrcIssueCount =
        this.bestSnapshot.issueCount
      if (this.bestSnapshot.issueCount === 0) {
        this.finish({ stoppedAfterNoImprovement: true })
        return
      }
      this.buildCandidatePlan()
    }

    let candidatePlanEntry: CandidatePlanEntry
    let candidateRoutes: HighDensityRoute[] | undefined
    do {
      if (this.candidateAttempts >= this.maxCandidateAttempts) {
        if (this.pendingCandidate) {
          if (this.acceptCandidate(this.pendingCandidate)) return
        }
        this.finish({
          stoppedAfterNoImprovement: false,
          hitCandidateLimit: true,
        })
        return
      }
      const nextCandidate = this.candidatePlan[this.candidatePlanIndex]
      if (!nextCandidate) {
        if (this.pendingCandidate) {
          this.acceptCandidate(this.pendingCandidate)
          return
        }
        this.finish({ stoppedAfterNoImprovement: true })
        return
      }
      candidatePlanEntry = nextCandidate
      this.candidatePlanIndex += 1
      this.attemptedCandidateKeys.add(candidatePlanEntry.key)
      candidateRoutes = this.createCandidateRoutes(candidatePlanEntry)
    } while (!candidateRoutes)

    this.candidateAttempts += 1
    this.candidateAttemptsSinceAccepted += 1
    this.candidateAttemptsSinceCountReduction += 1
    const candidateScoringSnapshot = this.evaluateCandidate(candidateRoutes)
    const bestCandidateSnapshot = this.bestCandidateSnapshot
    if (!bestCandidateSnapshot) {
      throw new Error("Missing residual reroute candidate DRC checkpoint")
    }
    const shouldValidateCandidate =
      !this.config.candidateDrcEvaluator ||
      candidatePlanEntry.type === "terminal_snap" ||
      isBetterSnapshot(candidateScoringSnapshot, bestCandidateSnapshot)
    if (shouldValidateCandidate) {
      const candidateSnapshot = this.config.candidateDrcEvaluator
        ? this.evaluateValidation(candidateRoutes)
        : candidateScoringSnapshot
      if (candidateSnapshot.issueCount < this.bestSnapshot.issueCount) {
        this.acceptCandidate({
          routes: candidateRoutes,
          snapshot: candidateSnapshot,
          candidateSnapshot: candidateScoringSnapshot,
          entry: candidatePlanEntry,
        })
        return
      }
      if (
        isBetterSnapshot(candidateSnapshot, this.bestSnapshot) &&
        (!this.pendingCandidate ||
          isBetterSnapshot(candidateSnapshot, this.pendingCandidate.snapshot))
      ) {
        this.pendingCandidate = {
          routes: candidateRoutes,
          snapshot: candidateSnapshot,
          candidateSnapshot: candidateScoringSnapshot,
          entry: candidatePlanEntry,
        }
      }
    }
    if (
      this.maxCandidatesWithoutCountReduction <
        this.maxCandidateAttempts &&
      this.candidateAttemptsSinceCountReduction >=
        this.maxCandidatesWithoutCountReduction
    ) {
      if (this.pendingCandidate) {
        if (this.acceptCandidate(this.pendingCandidate)) return
      }
      this.finish({
        stoppedAfterNoImprovement: true,
        stoppedAfterCountPlateau: true,
      })
      return
    }
    if (
      this.pendingCandidate &&
      this.candidateAttemptsSinceAccepted >= this.maxCandidatesBeforeRefinement
    ) {
      this.acceptCandidate(this.pendingCandidate)
      return
    }

    this.progress = Math.min(
      0.99,
      this.candidateAttempts / Math.max(1, this.maxCandidateAttempts),
    )
  }
}

