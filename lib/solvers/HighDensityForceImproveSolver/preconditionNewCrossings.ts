import { getProjectionSegmentDistanceCandidates } from "high-density-repair01/lib/utils/force-improve-segment-helpers"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

type Vector = { x: number; y: number }

type SegmentRef = {
  routeIndex: number
  startIndex: number
  start: Vector & { z: number }
  end: Vector & { z: number }
}

type SignedBarrier = {
  left: SegmentRef
  right: SegmentRef
  directionX: number
  directionY: number
  requiredDistance: number
}

export type PreconditionNewCrossingsResult = {
  routes: HighDensityRoute[]
  barrierCount: number
}

const INTERSECTION_EPSILON = 1e-6
const BARRIER_CLEARANCE_SLACK = 0.015
const DEFAULT_PASS_COUNT = 3
const DEFAULT_MAX_MOVE = 0.025

const collectSegments = (routes: HighDensityRoute[]): SegmentRef[] => {
  const segments: SegmentRef[] = []
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex]
    if (!route) continue
    for (
      let startIndex = 0;
      startIndex < route.route.length - 1;
      startIndex += 1
    ) {
      const start = route.route[startIndex]
      const end = route.route[startIndex + 1]
      if (
        !start ||
        !end ||
        start.z !== end.z ||
        (start.x === end.x && start.y === end.y)
      ) {
        continue
      }
      segments.push({ routeIndex, startIndex, start, end })
    }
  }
  return segments
}

const getDistance = (left: SegmentRef, right: SegmentRef): number => {
  const [candidate] = getProjectionSegmentDistanceCandidates(left, right)
  if (!candidate) return Number.POSITIVE_INFINITY
  return Math.hypot(
    candidate.leftPoint.x - candidate.rightPoint.x,
    candidate.leftPoint.y - candidate.rightPoint.y,
  )
}

const findClosestAdjacent = (
  segments: SegmentRef[],
  segment: SegmentRef,
  other: SegmentRef,
): SegmentRef | undefined => {
  let closestSegment: SegmentRef | undefined
  let closestDistance = Number.POSITIVE_INFINITY
  for (const candidate of segments) {
    const isAdjacent =
      candidate.startIndex + 1 === segment.startIndex ||
      candidate.startIndex === segment.startIndex + 1
    if (
      candidate.routeIndex !== segment.routeIndex ||
      candidate.start.z !== segment.start.z ||
      !isAdjacent
    ) {
      continue
    }
    const distance = getDistance(candidate, other)
    if (distance >= closestDistance) continue
    closestSegment = candidate
    closestDistance = distance
  }
  return closestSegment
}

const doSegmentBoundsOverlap = (
  left: SegmentRef,
  right: SegmentRef,
): boolean => {
  return !(
    Math.max(left.start.x, left.end.x) <
      Math.min(right.start.x, right.end.x) ||
    Math.max(right.start.x, right.end.x) <
      Math.min(left.start.x, left.end.x) ||
    Math.max(left.start.y, left.end.y) <
      Math.min(right.start.y, right.end.y) ||
    Math.max(right.start.y, right.end.y) <
      Math.min(left.start.y, left.end.y)
  )
}

const findNewCrossingBarriers = (
  rawRoutes: HighDensityRoute[],
  baselineRoutes: HighDensityRoute[],
): SignedBarrier[] => {
  const rawSegments = collectSegments(rawRoutes)
  const baselineSegments = collectSegments(baselineRoutes)
  const rawByKey = new Map<string, SegmentRef>(
    rawSegments.map((segment) => [
      `${segment.routeIndex}:${segment.startIndex}`,
      segment,
    ]),
  )
  const barriers: SignedBarrier[] = []
  const barrierKeys = new Set<string>()

  for (let leftIndex = 0; leftIndex < baselineSegments.length; leftIndex += 1) {
    const left = baselineSegments[leftIndex]
    if (!left) continue
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < baselineSegments.length;
      rightIndex += 1
    ) {
      const right = baselineSegments[rightIndex]
      const leftRoute = baselineRoutes[left.routeIndex]
      const rightRoute = right ? baselineRoutes[right.routeIndex] : undefined
      if (
        !right ||
        !leftRoute ||
        !rightRoute ||
        left.start.z !== right.start.z ||
        !doSegmentBoundsOverlap(left, right) ||
        (leftRoute.rootConnectionName ?? leftRoute.connectionName) ===
          (rightRoute.rootConnectionName ?? rightRoute.connectionName)
      ) {
        continue
      }
      const [crossing] = getProjectionSegmentDistanceCandidates(left, right)
      if (
        !crossing ||
        getDistance(left, right) > INTERSECTION_EPSILON ||
        crossing.leftT <= INTERSECTION_EPSILON ||
        crossing.leftT >= 1 - INTERSECTION_EPSILON ||
        crossing.rightT <= INTERSECTION_EPSILON ||
        crossing.rightT >= 1 - INTERSECTION_EPSILON
      ) {
        continue
      }
      const rawLeft = rawByKey.get(`${left.routeIndex}:${left.startIndex}`)
      const rawRight = rawByKey.get(`${right.routeIndex}:${right.startIndex}`)
      if (
        !rawLeft ||
        !rawRight ||
        getDistance(rawLeft, rawRight) <= INTERSECTION_EPSILON
      ) {
        continue
      }
      const leftAdjacent = findClosestAdjacent(rawSegments, rawLeft, rawRight)
      const rightAdjacent = findClosestAdjacent(rawSegments, rawRight, rawLeft)
      const leftCorridor = leftAdjacent ? [rawLeft, leftAdjacent] : [rawLeft]
      const rightCorridor = rightAdjacent ? [rawRight, rightAdjacent] : [rawRight]

      for (const rawLeftSegment of leftCorridor) {
        for (const rawRightSegment of rightCorridor) {
          const barrierKey = [
            rawLeftSegment.routeIndex,
            rawLeftSegment.startIndex,
            rawRightSegment.routeIndex,
            rawRightSegment.startIndex,
          ].join(":")
          if (barrierKeys.has(barrierKey)) continue
          const [rawCandidate] = getProjectionSegmentDistanceCandidates(
            rawLeftSegment,
            rawRightSegment,
          )
          if (!rawCandidate) continue
          const separationX =
            rawCandidate.leftPoint.x - rawCandidate.rightPoint.x
          const separationY =
            rawCandidate.leftPoint.y - rawCandidate.rightPoint.y
          const distance = Math.hypot(separationX, separationY)
          if (distance <= INTERSECTION_EPSILON) continue
          barrierKeys.add(barrierKey)
          barriers.push({
            left: rawLeftSegment,
            right: rawRightSegment,
            directionX: separationX / distance,
            directionY: separationY / distance,
            requiredDistance:
              (leftRoute.traceThickness + rightRoute.traceThickness) / 2 +
              BARRIER_CLEARANCE_SLACK,
          })
        }
      }
    }
  }
  return barriers
}

const moveRoutePoint = (
  routes: HighDensityRoute[],
  routeIndex: number,
  pointIndex: number,
  dx: number,
  dy: number,
  node: NodeWithPortPoints,
): void => {
  const route = routes[routeIndex]
  const reference = route?.route[pointIndex]
  if (!route || !reference) return
  const referenceX = reference.x
  const referenceY = reference.y
  const coincidentPointIndexes = [pointIndex]
  for (let index = pointIndex - 1; index >= 0; index -= 1) {
    const point = route.route[index]
    if (!point || point.x !== referenceX || point.y !== referenceY) break
    coincidentPointIndexes.unshift(index)
  }
  for (let index = pointIndex + 1; index < route.route.length; index += 1) {
    const point = route.route[index]
    if (!point || point.x !== referenceX || point.y !== referenceY) break
    coincidentPointIndexes.push(index)
  }
  const includesProtectedEndpoint = coincidentPointIndexes.some(
    (index) => index <= 1 || index >= route.route.length - 2,
  )
  if (includesProtectedEndpoint) return

  const occupiedLayers = new Set(
    coincidentPointIndexes.map((index) => route.route[index]?.z),
  )
  const boundaryPadding =
    occupiedLayers.size > 1 ? route.viaDiameter / 2 : 0
  const minX =
    node.center.x - node.width / 2 + boundaryPadding + INTERSECTION_EPSILON
  const maxX =
    node.center.x + node.width / 2 - boundaryPadding - INTERSECTION_EPSILON
  const minY =
    node.center.y - node.height / 2 + boundaryPadding + INTERSECTION_EPSILON
  const maxY =
    node.center.y + node.height / 2 - boundaryPadding - INTERSECTION_EPSILON
  for (const candidateIndex of coincidentPointIndexes) {
    const point = route.route[candidateIndex]
    if (!point) continue
    point.x = Math.max(minX, Math.min(maxX, point.x + dx))
    point.y = Math.max(minY, Math.min(maxY, point.y + dy))
  }
}

const moveSegment = (
  routes: HighDensityRoute[],
  segment: SegmentRef,
  dx: number,
  dy: number,
  t: number,
  node: NodeWithPortPoints,
): void => {
  moveRoutePoint(
    routes,
    segment.routeIndex,
    segment.startIndex,
    dx * (1 - t),
    dy * (1 - t),
    node,
  )
  moveRoutePoint(
    routes,
    segment.routeIndex,
    segment.startIndex + 1,
    dx * t,
    dy * t,
    node,
  )
}

/**
 * Preserves the raw side ordering around crossings created by force
 * improvement. Only the crossing segments and their nearest adjacent segments
 * are nudged, giving the stock solver a non-crossing starting corridor.
 */
export const preconditionNewCrossings = (params: {
  rawRoutes: HighDensityRoute[]
  baselineRoutes: HighDensityRoute[]
  node: NodeWithPortPoints
  passCount?: number
  maxMove?: number
}): PreconditionNewCrossingsResult => {
  const { rawRoutes, baselineRoutes, node } = params
  const routes = structuredClone(rawRoutes)
  const barriers = findNewCrossingBarriers(rawRoutes, baselineRoutes)
  const passCount = params.passCount ?? DEFAULT_PASS_COUNT
  const maxMove = params.maxMove ?? DEFAULT_MAX_MOVE
  for (let pass = 0; pass < passCount; pass += 1) {
    for (const barrier of barriers) {
      const leftRoute = routes[barrier.left.routeIndex]
      const rightRoute = routes[barrier.right.routeIndex]
      if (!leftRoute || !rightRoute) continue
      const left = {
        start: leftRoute.route[barrier.left.startIndex]!,
        end: leftRoute.route[barrier.left.startIndex + 1]!,
      }
      const right = {
        start: rightRoute.route[barrier.right.startIndex]!,
        end: rightRoute.route[barrier.right.startIndex + 1]!,
      }
      const [candidate] = getProjectionSegmentDistanceCandidates(left, right)
      if (!candidate) continue
      const signedDistance =
        (candidate.leftPoint.x - candidate.rightPoint.x) *
          barrier.directionX +
        (candidate.leftPoint.y - candidate.rightPoint.y) * barrier.directionY
      const penetration = barrier.requiredDistance - signedDistance
      if (penetration <= 0) continue
      const move = Math.min(maxMove, penetration / 2)
      moveSegment(
        routes,
        barrier.left,
        barrier.directionX * move,
        barrier.directionY * move,
        candidate.leftT,
        node,
      )
      moveSegment(
        routes,
        barrier.right,
        -barrier.directionX * move,
        -barrier.directionY * move,
        candidate.rightT,
        node,
      )
    }
  }
  for (const route of routes) {
    route.vias = route.route.slice(0, -1).flatMap((point, index) => {
      const next = route.route[index + 1]
      return next &&
        point.z !== next.z &&
        point.x === next.x &&
        point.y === next.y
        ? [{ x: point.x, y: point.y }]
        : []
    })
  }
  return { routes, barrierCount: barriers.length }
}
