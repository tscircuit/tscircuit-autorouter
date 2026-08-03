import type { DrcEvaluator } from "high-density-repair03/lib"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  clonePipeline9HdRoutes,
  getPipeline9DrcErrors,
  getPipeline9RouteIndexByTraceId,
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "./pipeline9-joint-drc-repair-utils"

type TargetedObstacleDetourResult = {
  routes: HighDensityRoute[]
  attemptedCandidateCount: number
  acceptedCandidateCount: number
}

const HALF_SPANS = [0.2, 0.45, 0.8]
const OFFSETS = [0.2, 0.4, 0.65]
const POSITION_EPSILON = 1e-9

const isObstacleTraceError = (error: Pipeline9DrcError) => {
  if (error.type === "pcb_pad_trace_clearance_error") return true
  if (error.type !== "pcb_trace_error") return false
  if (Array.isArray(error.pcb_trace_ids) && error.pcb_trace_ids.length >= 2) {
    return false
  }
  const message = typeof error.message === "string" ? error.message : ""
  return (
    message.includes("pcb_smtpad") ||
    message.includes("pcb_plated_hole") ||
    message.includes("pcb_hole") ||
    message.includes("pcb_keepout")
  )
}

const getErrorCenter = (error: Pipeline9DrcError) => {
  const center = error.center
  return center &&
    typeof center === "object" &&
    "x" in center &&
    "y" in center &&
    typeof center.x === "number" &&
    typeof center.y === "number"
    ? { x: center.x, y: center.y }
    : undefined
}

const getObstacleCenterForError = (
  error: Pipeline9DrcError,
  srj: SimpleRouteJson,
) => {
  const errorCenter = getErrorCenter(error)
  const message = typeof error.message === "string" ? error.message : ""
  const messageObstacleId = message.match(
    /(?:pcb_smtpad|pcb_plated_hole|pcb_hole|pcb_keepout)\[#?([^\]"]+)\]/,
  )?.[1]
  const errorIdObstacleId =
    typeof error.pcb_trace_error_id === "string"
      ? error.pcb_trace_error_id.match(
          /(pcb_(?:smtpad|plated_hole|hole|keepout)_\d+)$/,
        )?.[1]
      : undefined
  const obstacleIds = [
    typeof error.pcb_pad_id === "string" ? error.pcb_pad_id : undefined,
    errorIdObstacleId,
    messageObstacleId,
    messageObstacleId?.startsWith("pcb_")
      ? messageObstacleId
      : messageObstacleId
        ? `pcb_${messageObstacleId}`
        : undefined,
  ].filter((obstacleId): obstacleId is string => Boolean(obstacleId))
  const exactMatchingObstacles = srj.obstacles.filter(
    (obstacle) =>
      (obstacle.obstacleId && obstacleIds.includes(obstacle.obstacleId)) ||
      (obstacle.connectedTo[0] !== undefined &&
        obstacleIds.includes(obstacle.connectedTo[0])),
  )
  const matchingObstacles =
    exactMatchingObstacles.length > 0
      ? exactMatchingObstacles
      : srj.obstacles.filter((obstacle) =>
          obstacleIds.some((obstacleId) =>
            obstacle.connectedTo.includes(obstacleId),
          ),
        )
  if (matchingObstacles.length === 0) return errorCenter
  if (!errorCenter) return matchingObstacles[0]!.center
  return matchingObstacles.reduce((nearest, obstacle) =>
    Math.hypot(
      obstacle.center.x - errorCenter.x,
      obstacle.center.y - errorCenter.y,
    ) <
    Math.hypot(
      nearest.center.x - errorCenter.x,
      nearest.center.y - errorCenter.y,
    )
      ? obstacle
      : nearest,
  ).center
}

const getNearestSameLayerSegmentIndex = (
  route: HighDensityRoute,
  center: { x: number; y: number },
) => {
  let bestSegmentIndex = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (
    let segmentIndex = 0;
    segmentIndex < route.route.length - 1;
    segmentIndex++
  ) {
    const start = route.route[segmentIndex]!
    const end = route.route[segmentIndex + 1]!
    if (start.z !== end.z) continue
    const segmentX = end.x - start.x
    const segmentY = end.y - start.y
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2
    if (segmentLengthSquared <= POSITION_EPSILON) continue
    const t = Math.max(
      0,
      Math.min(
        1,
        ((center.x - start.x) * segmentX + (center.y - start.y) * segmentY) /
          segmentLengthSquared,
      ),
    )
    const distance = Math.hypot(
      start.x + segmentX * t - center.x,
      start.y + segmentY * t - center.y,
    )
    if (distance < bestDistance) {
      bestDistance = distance
      bestSegmentIndex = segmentIndex
    }
  }
  return bestSegmentIndex
}

const createDetourCandidate = ({
  routes,
  routeIndex,
  segmentIndex,
  center,
  halfSpan,
  offset,
  directionSign,
  bounds,
}: {
  routes: HighDensityRoute[]
  routeIndex: number
  segmentIndex: number
  center: { x: number; y: number }
  halfSpan: number
  offset: number
  directionSign: -1 | 1
  bounds: SimpleRouteJson["bounds"]
}): HighDensityRoute[] | undefined => {
  const candidateRoutes = clonePipeline9HdRoutes(routes)
  const route = candidateRoutes[routeIndex]
  const start = route?.route[segmentIndex]
  const end = route?.route[segmentIndex + 1]
  if (!route || !start || !end || start.z !== end.z) return undefined

  const segmentX = end.x - start.x
  const segmentY = end.y - start.y
  const segmentLength = Math.hypot(segmentX, segmentY)
  if (segmentLength <= POSITION_EPSILON) return undefined
  const projectionT = Math.max(
    0,
    Math.min(
      1,
      ((center.x - start.x) * segmentX + (center.y - start.y) * segmentY) /
        segmentLength ** 2,
    ),
  )
  const halfSpanT = halfSpan / segmentLength
  const beforeT = Math.max(0.01, projectionT - halfSpanT)
  const afterT = Math.min(0.99, projectionT + halfSpanT)
  if (beforeT >= afterT) return undefined

  const pointAt = (t: number) => ({
    x: start.x + segmentX * t,
    y: start.y + segmentY * t,
    z: start.z,
  })
  const before = pointAt(beforeT)
  const after = pointAt(afterT)
  const normalX = (-segmentY / segmentLength) * directionSign
  const normalY = (segmentX / segmentLength) * directionSign
  const detourBefore = {
    ...before,
    x: before.x + normalX * offset,
    y: before.y + normalY * offset,
  }
  const detourAfter = {
    ...after,
    x: after.x + normalX * offset,
    y: after.y + normalY * offset,
  }
  const radius = route.traceThickness / 2
  if (
    [before, detourBefore, detourAfter, after].some(
      (point) =>
        point.x - radius < bounds.minX ||
        point.x + radius > bounds.maxX ||
        point.y - radius < bounds.minY ||
        point.y + radius > bounds.maxY,
    )
  ) {
    return undefined
  }

  route.route.splice(
    segmentIndex,
    2,
    { ...start },
    before,
    detourBefore,
    detourAfter,
    after,
    { ...end },
  )
  return candidateRoutes
}

/** Tries a small same-layer dogleg portfolio for unresolved trace-to-pad errors. */
export const applyPipeline9TargetedObstacleDetours = ({
  srj,
  routes,
  newConnections,
  syntheticConnectionNames,
  drcEvaluator,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  newConnections: SimpleRouteConnection[]
  syntheticConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
}): TargetedObstacleDetourResult => {
  let currentRoutes = routes
  let currentErrors = getPipeline9DrcErrors(drcEvaluator, currentRoutes)
  let attemptedCandidateCount = 0
  let acceptedCandidateCount = 0

  for (let pass = 0; pass < 2; pass++) {
    let acceptedOnPass = false
    const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
      routes: currentRoutes,
      newConnections,
      syntheticConnectionNames,
    })
    for (const error of currentErrors.filter(isObstacleTraceError)) {
      const traceId = error.pcb_trace_id
      const center = getObstacleCenterForError(error, srj)
      if (typeof traceId !== "string" || !center) continue
      const routeIndex = routeIndexByTraceId.get(traceId)
      if (routeIndex === undefined) continue
      const segmentIndex = getNearestSameLayerSegmentIndex(
        currentRoutes[routeIndex]!,
        center,
      )
      if (segmentIndex < 0) continue

      let bestRoutes = currentRoutes
      let bestErrors = currentErrors
      for (const halfSpan of HALF_SPANS) {
        for (const offset of OFFSETS) {
          for (const directionSign of [-1, 1] as const) {
            const candidateRoutes = createDetourCandidate({
              routes: currentRoutes,
              routeIndex,
              segmentIndex,
              center,
              halfSpan,
              offset,
              directionSign,
              bounds: srj.bounds,
            })
            if (!candidateRoutes) continue
            attemptedCandidateCount++
            const candidateErrors = getPipeline9DrcErrors(
              drcEvaluator,
              candidateRoutes,
            )
            if (isPipeline9DrcCandidateBetter(candidateErrors, bestErrors)) {
              bestRoutes = candidateRoutes
              bestErrors = candidateErrors
            }
          }
        }
      }
      if (bestRoutes !== currentRoutes) {
        currentRoutes = bestRoutes
        currentErrors = bestErrors
        acceptedCandidateCount++
        acceptedOnPass = true
      }
    }
    if (!acceptedOnPass || currentErrors.length === 0) break
  }

  return {
    routes: currentRoutes,
    attemptedCandidateCount,
    acceptedCandidateCount,
  }
}
