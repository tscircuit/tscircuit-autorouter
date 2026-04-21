import { BaseSolver } from "lib/solvers/BaseSolver"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

type Point = { x: number; y: number }
type MutableRoute = HighDensityRoute & {
  route: Array<HighDensityRoute["route"][number]>
  vias: Array<HighDensityRoute["vias"][number]>
}
type ViaNode = {
  routeIndex: number
  pointIndexes: number[]
  x: number
  y: number
  movable: boolean
}
type Segment = {
  routeIndex: number
  startIndex: number
  endIndex: number
  start: Point
  end: Point
}
type DrcSnapshot = {
  errors: Array<Record<string, unknown>>
  count: number
  traceRouteIndexById: Map<string, number>
}
type GlobalDrcForceImproveSolverParams = {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  effort?: number
}

const POSITION_EPSILON = 1e-6
const COORDINATE_EPSILON = 1e-3
const MAX_ERROR_MOVE = 0.14
const BASE_MAX_PASSES = 14
const BASE_MAX_CANDIDATE_ATTEMPTS = 28
const FAST_ERROR_FORCE_SCALES = [1, 1.75, -1] as const
const DEEP_ERROR_FORCE_SCALES = [1, 1.75, 2.5, -1, -1.75] as const

const cloneRoutes = (routes: HighDensityRoute[]): MutableRoute[] =>
  routes.map((route) => ({
    ...route,
    route: route.route.map((point) => ({ ...point })),
    vias: route.vias.map((via) => ({ ...via })),
  }))

const areSameXY = (left: Point, right: Point) =>
  Math.abs(left.x - right.x) <= COORDINATE_EPSILON &&
  Math.abs(left.y - right.y) <= COORDINATE_EPSILON

const clampValue = (value: number, minValue: number, maxValue: number) =>
  Math.max(minValue, Math.min(value, maxValue))

const clampToBounds = (point: Point, bounds: SimpleRouteJson["bounds"]) => {
  point.x = clampValue(point.x, bounds.minX, bounds.maxX)
  point.y = clampValue(point.y, bounds.minY, bounds.maxY)
}

const createSimplifiedTraces = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
): {
  traces: SimplifiedPcbTraces
  traceRouteIndexById: Map<string, number>
} => {
  const traces: SimplifiedPcbTraces = []
  const traceRouteIndexById = new Map<string, number>()

  for (const connection of srj.connections) {
    const hdRoutes = routes
      .map((route, routeIndex) => ({ route, routeIndex }))
      .filter(({ route }) => route.connectionName === connection.name)

    for (let i = 0; i < hdRoutes.length; i += 1) {
      const hdRoute = hdRoutes[i]
      if (!hdRoute) continue
      const traceId = `${connection.name}_${i}`

      traces.push({
        type: "pcb_trace",
        pcb_trace_id: traceId,
        connection_name:
          connection.netConnectionName ??
          connection.rootConnectionName ??
          connection.name,
        route: convertHdRouteToSimplifiedRoute(hdRoute.route, srj.layerCount, {
          connectionPoints: connection.pointsToConnect,
        }),
      })
      traceRouteIndexById.set(traceId, hdRoute.routeIndex)
    }
  }

  return { traces, traceRouteIndexById }
}

const getDrcSnapshot = (
  srj: SimpleRouteJson,
  routes: HighDensityRoute[],
): DrcSnapshot => {
  const { traces, traceRouteIndexById } = createSimplifiedTraces(srj, routes)
  const drc = getDrcErrors(
    convertToCircuitJson(srj, traces, srj.minTraceWidth, srj.minViaDiameter),
    RELAXED_DRC_OPTIONS,
  )

  return {
    errors: drc.errorsWithCenters as unknown as Array<Record<string, unknown>>,
    count: drc.errors.length,
    traceRouteIndexById,
  }
}

const collectViaNodes = (routes: MutableRoute[]): ViaNode[] => {
  const vias: ViaNode[] = []

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex]
    if (!route) continue
    const seenIndexes = new Set<number>()

    for (let index = 0; index < route.route.length - 1; index += 1) {
      const current = route.route[index]
      const next = route.route[index + 1]
      if (!current || !next) continue
      if (current.z === next.z || !areSameXY(current, next)) continue

      const pointIndexes = [index, index + 1]
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const point = route.route[cursor]
        if (!point || !areSameXY(point, current)) break
        pointIndexes.push(cursor)
      }
      for (let cursor = index + 2; cursor < route.route.length; cursor += 1) {
        const point = route.route[cursor]
        if (!point || !areSameXY(point, current)) break
        pointIndexes.push(cursor)
      }

      const uniquePointIndexes = [...new Set(pointIndexes)]
      if (
        uniquePointIndexes.some((pointIndex) => seenIndexes.has(pointIndex))
      ) {
        continue
      }
      for (const pointIndex of uniquePointIndexes) {
        seenIndexes.add(pointIndex)
      }

      vias.push({
        routeIndex,
        pointIndexes: uniquePointIndexes,
        x: current.x,
        y: current.y,
        movable:
          !uniquePointIndexes.includes(0) &&
          !uniquePointIndexes.includes(route.route.length - 1),
      })
    }
  }

  return vias
}

const collectSegments = (routes: MutableRoute[]): Segment[] => {
  const segments: Segment[] = []

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex]
    if (!route) continue

    for (let index = 0; index < route.route.length - 1; index += 1) {
      const start = route.route[index]
      const end = route.route[index + 1]
      if (!start || !end) continue
      if (start.z !== end.z || areSameXY(start, end)) continue
      segments.push({
        routeIndex,
        startIndex: index,
        endIndex: index + 1,
        start,
        end,
      })
    }
  }

  return segments
}

const pointToSegmentProjection = (point: Point, segment: Segment) => {
  const segmentX = segment.end.x - segment.start.x
  const segmentY = segment.end.y - segment.start.y
  const lengthSquared = segmentX * segmentX + segmentY * segmentY
  if (lengthSquared <= POSITION_EPSILON) {
    return { x: segment.start.x, y: segment.start.y, t: 0 }
  }

  const t = clampValue(
    ((point.x - segment.start.x) * segmentX +
      (point.y - segment.start.y) * segmentY) /
      lengthSquared,
    0,
    1,
  )

  return {
    x: segment.start.x + segmentX * t,
    y: segment.start.y + segmentY * t,
    t,
  }
}

const getPointToObstacleDistance = (
  point: Point,
  obstacle: SimpleRouteJson["obstacles"][number],
) => {
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  const dx = Math.max(Math.abs(point.x - obstacle.center.x) - halfWidth, 0)
  const dy = Math.max(Math.abs(point.y - obstacle.center.y) - halfHeight, 0)
  return Math.hypot(dx, dy)
}

const getRepulsionPointForError = (
  srj: SimpleRouteJson,
  error: Record<string, unknown>,
  center: Point,
) => {
  const message = error.message
  if (typeof message !== "string" || !message.includes("pcb_")) {
    return center
  }

  let nearestObstacle:
    | {
        point: Point
        distance: number
      }
    | undefined

  for (const obstacle of srj.obstacles) {
    const distance = getPointToObstacleDistance(center, obstacle)
    if (distance > 0.6) continue
    if (!nearestObstacle || distance < nearestObstacle.distance) {
      nearestObstacle = {
        point: obstacle.center,
        distance,
      }
    }
  }

  return nearestObstacle?.point ?? center
}

const getCoincidentPointIndexes = (route: MutableRoute, pointIndex: number) => {
  const point = route.route[pointIndex]
  if (!point) return []
  const pointIndexes = [pointIndex]

  for (let cursor = pointIndex - 1; cursor >= 0; cursor -= 1) {
    const candidate = route.route[cursor]
    if (!candidate || !areSameXY(candidate, point)) break
    pointIndexes.push(cursor)
  }
  for (let cursor = pointIndex + 1; cursor < route.route.length; cursor += 1) {
    const candidate = route.route[cursor]
    if (!candidate || !areSameXY(candidate, point)) break
    pointIndexes.push(cursor)
  }

  return [...new Set(pointIndexes)]
}

const moveRoutePoint = (
  routes: MutableRoute[],
  routeIndex: number,
  pointIndex: number,
  dx: number,
  dy: number,
  bounds: SimpleRouteJson["bounds"],
) => {
  const route = routes[routeIndex]
  if (!route || pointIndex <= 0 || pointIndex >= route.route.length - 1) {
    return false
  }

  const pointIndexes = getCoincidentPointIndexes(route, pointIndex)
  if (
    pointIndexes.includes(0) ||
    pointIndexes.includes(route.route.length - 1)
  ) {
    return false
  }

  let changed = false
  for (const candidateIndex of pointIndexes) {
    const point = route.route[candidateIndex]
    if (!point) continue
    point.x += dx
    point.y += dy
    clampToBounds(point, bounds)
    changed = true
  }

  return changed
}

const getDirectionAwayFromPoint = (segment: Segment, point: Point) => {
  const projection = pointToSegmentProjection(point, segment)
  const separationX = projection.x - point.x
  const separationY = projection.y - point.y
  const distance = Math.hypot(separationX, separationY)
  const segmentX = segment.end.x - segment.start.x
  const segmentY = segment.end.y - segment.start.y
  const segmentLength = Math.hypot(segmentX, segmentY)
  const fallbackSign = segment.routeIndex % 2 === 0 ? 1 : -1

  return {
    projection,
    direction:
      distance > POSITION_EPSILON
        ? {
            x: separationX / distance,
            y: separationY / distance,
          }
        : segmentLength > POSITION_EPSILON
          ? {
              x: (-segmentY / segmentLength) * fallbackSign,
              y: (segmentX / segmentLength) * fallbackSign,
            }
          : { x: 1, y: 0 },
  }
}

const insertDetourPointAwayFromPoint = (
  routes: MutableRoute[],
  segment: Segment,
  point: Point,
  bounds: SimpleRouteJson["bounds"],
  scale: number,
) => {
  const route = routes[segment.routeIndex]
  if (!route) return false

  const { projection, direction } = getDirectionAwayFromPoint(segment, point)
  const detourPoint = {
    ...route.route[segment.startIndex]!,
    x: projection.x + direction.x * MAX_ERROR_MOVE * scale,
    y: projection.y + direction.y * MAX_ERROR_MOVE * scale,
  }
  clampToBounds(detourPoint, bounds)
  route.route.splice(segment.endIndex, 0, detourPoint)
  return true
}

const moveVia = (
  routes: MutableRoute[],
  via: ViaNode,
  dx: number,
  dy: number,
  bounds: SimpleRouteJson["bounds"],
) => {
  if (!via.movable) return false
  const route = routes[via.routeIndex]
  if (!route) return false

  via.x += dx
  via.y += dy
  clampToBounds(via, bounds)
  for (const pointIndex of via.pointIndexes) {
    const point = route.route[pointIndex]
    if (!point) continue
    point.x = via.x
    point.y = via.y
  }
  return true
}

const moveSegmentAwayFromPoint = (
  routes: MutableRoute[],
  segment: Segment,
  point: Point,
  bounds: SimpleRouteJson["bounds"],
  scale = 1,
) => {
  const { projection, direction } = getDirectionAwayFromPoint(segment, point)
  const move = MAX_ERROR_MOVE * scale
  const startWeight = 1 - projection.t
  const endWeight = projection.t

  const movedStart = moveRoutePoint(
    routes,
    segment.routeIndex,
    segment.startIndex,
    direction.x * move * startWeight,
    direction.y * move * startWeight,
    bounds,
  )
  const movedEnd = moveRoutePoint(
    routes,
    segment.routeIndex,
    segment.endIndex,
    direction.x * move * endWeight,
    direction.y * move * endWeight,
    bounds,
  )

  if (movedStart || movedEnd) {
    return true
  }

  return insertDetourPointAwayFromPoint(routes, segment, point, bounds, scale)
}

const getNearestSegment = (
  segments: Segment[],
  point: Point,
  routeIndex?: number,
) => {
  let best:
    | {
        segment: Segment
        distance: number
      }
    | undefined

  for (const segment of segments) {
    if (routeIndex !== undefined && segment.routeIndex !== routeIndex) continue
    const projection = pointToSegmentProjection(point, segment)
    const distance = Math.hypot(projection.x - point.x, projection.y - point.y)
    if (!best || distance < best.distance) {
      best = { segment, distance }
    }
  }

  return best?.segment
}

const getNearestVia = (vias: ViaNode[], point: Point) => {
  let best:
    | {
        via: ViaNode
        distance: number
      }
    | undefined

  for (const via of vias) {
    const distance = Math.hypot(via.x - point.x, via.y - point.y)
    if (!best || distance < best.distance) {
      best = { via, distance }
    }
  }

  return best?.via
}

const moveViaAwayFromPoint = (
  routes: MutableRoute[],
  via: ViaNode,
  point: Point,
  bounds: SimpleRouteJson["bounds"],
) => {
  const separationX = via.x - point.x
  const separationY = via.y - point.y
  const distance = Math.hypot(separationX, separationY)
  const directionX = distance > POSITION_EPSILON ? separationX / distance : 1
  const directionY = distance > POSITION_EPSILON ? separationY / distance : 0

  return moveVia(
    routes,
    via,
    directionX * MAX_ERROR_MOVE,
    directionY * MAX_ERROR_MOVE,
    bounds,
  )
}

const deriveVias = (route: MutableRoute): MutableRoute["vias"] => {
  const vias: MutableRoute["vias"] = []
  for (let index = 0; index < route.route.length - 1; index += 1) {
    const current = route.route[index]
    const next = route.route[index + 1]
    if (!current || !next) continue
    if (current.z === next.z || !areSameXY(current, next)) continue

    const via = {
      x: Number(current.x.toFixed(3)),
      y: Number(current.y.toFixed(3)),
    }
    const previousVia = vias.at(-1)
    if (previousVia && areSameXY(previousVia, via)) continue
    vias.push(via)
  }
  return vias
}

const materializeRoutes = (routes: MutableRoute[]): HighDensityRoute[] =>
  routes.map((route) => ({
    ...route,
    vias: deriveVias(route),
  }))

const parseTraceRouteIndex = (error: Record<string, unknown>) => {
  const traceId = error.pcb_trace_id
  if (typeof traceId !== "string") return undefined
  const match = traceId.match(/^trace_(\d+)/)
  return match ? Number.parseInt(match[1]!, 10) : undefined
}

const getErrorCenter = (error: Record<string, unknown>): Point | undefined => {
  const center = error.center ?? error.pcb_center
  if (!center || typeof center !== "object") return undefined
  const maybeCenter = center as Record<string, unknown>
  return typeof maybeCenter.x === "number" && typeof maybeCenter.y === "number"
    ? { x: maybeCenter.x, y: maybeCenter.y }
    : undefined
}

const getCenteredErrors = (errors: Array<Record<string, unknown>>) =>
  errors.filter((error) => Boolean(getErrorCenter(error)))

const getForceScalesForEffort = (effort: number) =>
  effort >= 2 ? DEEP_ERROR_FORCE_SCALES : FAST_ERROR_FORCE_SCALES

const getMaxPassesForEffort = (effort: number) =>
  Math.max(8, Math.round(BASE_MAX_PASSES * Math.max(1, effort)))

const getMaxCandidateAttemptsForEffort = (effort: number) =>
  Math.max(12, Math.round(BASE_MAX_CANDIDATE_ATTEMPTS * Math.max(1, effort)))

const applyDrcErrorForces = (
  srj: SimpleRouteJson,
  routes: MutableRoute[],
  errors: Array<Record<string, unknown>>,
  traceRouteIndexById: Map<string, number>,
  scale: number,
) => {
  let changed = false
  const vias = collectViaNodes(routes)
  const segments = collectSegments(routes)

  for (const error of errors) {
    const center = getErrorCenter(error)
    if (!center) continue
    const repulsionPoint = getRepulsionPointForError(srj, error, center)

    const viaIds = error.pcb_via_ids
    if (Array.isArray(viaIds) && viaIds.length > 0) {
      const nearestVia = getNearestVia(vias, center)
      if (nearestVia) {
        changed =
          moveViaAwayFromPoint(
            routes,
            nearestVia,
            repulsionPoint,
            srj.bounds,
          ) || changed
      }
      continue
    }

    const traceId = error.pcb_trace_id
    const routeIndex =
      typeof traceId === "string"
        ? (traceRouteIndexById.get(traceId) ?? parseTraceRouteIndex(error))
        : parseTraceRouteIndex(error)
    const nearestSegment = getNearestSegment(segments, center, routeIndex)
    if (nearestSegment) {
      changed =
        moveSegmentAwayFromPoint(
          routes,
          nearestSegment,
          repulsionPoint,
          srj.bounds,
          scale,
        ) || changed
    }

    const nearestVia = getNearestVia(vias, center)
    if (
      nearestVia &&
      Math.hypot(nearestVia.x - center.x, nearestVia.y - center.y) < 0.35
    ) {
      changed =
        moveViaAwayFromPoint(routes, nearestVia, repulsionPoint, srj.bounds) ||
        changed
    }
  }

  return changed
}

export class GlobalDrcForceImproveSolver extends BaseSolver {
  readonly srj: SimpleRouteJson
  readonly inputHdRoutes: HighDensityRoute[]
  readonly effort: number
  outputHdRoutes: HighDensityRoute[]

  constructor(params: GlobalDrcForceImproveSolverParams) {
    super()
    this.srj = params.srj
    this.inputHdRoutes = params.hdRoutes
    this.effort = params.effort ?? 1
    this.outputHdRoutes = params.hdRoutes
    this.MAX_ITERATIONS = 1
  }

  override getConstructorParams() {
    return [
      { srj: this.srj, hdRoutes: this.inputHdRoutes, effort: this.effort },
    ] as const
  }

  override _step() {
    let bestRoutes = this.inputHdRoutes
    let bestSnapshot = getDrcSnapshot(this.srj, bestRoutes)
    let bestIssueCount = bestSnapshot.count
    const initialDrcIssueCount = bestIssueCount
    const forceScales = getForceScalesForEffort(this.effort)
    const maxPasses = getMaxPassesForEffort(this.effort)
    const maxCandidateAttempts = getMaxCandidateAttemptsForEffort(this.effort)
    let candidateAttempts = 0

    for (let pass = 0; pass < maxPasses && bestIssueCount > 0; pass += 1) {
      let accepted = false
      const errorsWithCenters = getCenteredErrors(bestSnapshot.errors)
      if (errorsWithCenters.length === 0) break

      for (const error of errorsWithCenters) {
        for (const scale of forceScales) {
          if (candidateAttempts >= maxCandidateAttempts) break
          candidateAttempts += 1
          const candidateRoutes = cloneRoutes(bestRoutes)
          const changed = applyDrcErrorForces(
            this.srj,
            candidateRoutes,
            [error],
            bestSnapshot.traceRouteIndexById,
            scale,
          )
          if (!changed) continue

          const materializedCandidateRoutes = materializeRoutes(candidateRoutes)
          const candidateSnapshot = getDrcSnapshot(
            this.srj,
            materializedCandidateRoutes,
          )
          if (candidateSnapshot.count < bestIssueCount) {
            bestRoutes = materializedCandidateRoutes
            bestSnapshot = candidateSnapshot
            bestIssueCount = candidateSnapshot.count
            accepted = true
            break
          }
        }

        if (accepted) {
          break
        }
        if (candidateAttempts >= maxCandidateAttempts) {
          break
        }
      }

      if (!accepted || candidateAttempts >= maxCandidateAttempts) {
        break
      }
    }

    this.outputHdRoutes = bestRoutes
    this.stats = {
      initialDrcIssueCount,
      finalDrcIssueCount: bestIssueCount,
      globalDrcForceImproveCandidateAttempts: candidateAttempts,
    }
    this.solved = true
  }

  getOutput() {
    return this.outputHdRoutes
  }
}
