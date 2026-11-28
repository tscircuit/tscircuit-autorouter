import {
  getSegmentIntersection,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type {
  PreloadedTracePortAssignment,
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import {
  PRELOADED_TRACE_TOLERANCE,
  type PreloadedTracePrimitive,
} from "./getPreloadedTracePrimitives"

type BoundaryCrossing = {
  segment: SharedEdgeSegment
  primitive: PreloadedTracePrimitive
  z: number
}

function getClosestPortPoint({
  segment,
  primitive,
  z,
}: BoundaryCrossing): SegmentPortPoint | undefined {
  return segment.portPoints
    .filter(
      (portPoint) =>
        portPoint.availableZ.includes(z) &&
        !(portPoint._preloadedTracePortAssignments ?? []).some(
          (assignment) =>
            assignment.z === z &&
            assignment.fixedNetId !== primitive.fixedNetId,
        ),
    )
    .map((portPoint) => ({
      portPoint,
      distance: pointToSegmentDistance(
        portPoint,
        primitive.start,
        primitive.end,
      ),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.portPoint.distToCentermostPortOnZ -
          right.portPoint.distToCentermostPortOnZ ||
        left.portPoint.segmentPortPointId.localeCompare(
          right.portPoint.segmentPortPointId,
        ),
    )[0]?.portPoint
}

function getFixedTracePortPoint({
  segment,
  primitive,
  z,
}: BoundaryCrossing): SegmentPortPoint | undefined {
  const crossing =
    primitive.start.x === primitive.end.x && primitive.start.y === primitive.end.y
      ? primitive.start
      : getSegmentIntersection(
          primitive.start,
          primitive.end,
          segment.start,
          segment.end,
        )
  // A collinear trace has no unique crossing along the shared edge.
  if (!crossing) return getClosestPortPoint({ segment, primitive, z })

  const existing = segment.portPoints.find(
    (candidate) =>
      candidate.availableZ.includes(z) &&
      Math.hypot(candidate.x - crossing.x, candidate.y - crossing.y) <
        PRELOADED_TRACE_TOLERANCE,
  )
  if (existing) return existing

  const edgeCenter = {
    x: (segment.start.x + segment.end.x) / 2,
    y: (segment.start.y + segment.end.y) / 2,
  }
  const portPoint: SegmentPortPoint = {
    segmentPortPointId: `${segment.edgeId}_fixed${segment.portPoints.length}_z${z}`,
    x: crossing.x,
    y: crossing.y,
    availableZ: [z],
    nodeIds: segment.nodeIds,
    edgeId: segment.edgeId,
    connectionName: null,
    distToCentermostPortOnZ: Math.hypot(
      crossing.x - edgeCenter.x,
      crossing.y - edgeCenter.y,
    ),
    cramped: false,
  }
  segment.portPoints.push(portPoint)
  return portPoint
}

function assignPreloadedPort({
  portPoint,
  primitive,
  z,
}: {
  portPoint: SegmentPortPoint
  primitive: PreloadedTracePrimitive
  z: number
}): void {
  portPoint._preloadedFixedNetIds = [
    ...new Set([
      ...(portPoint._preloadedFixedNetIds ?? []),
      primitive.fixedNetId,
    ]),
  ].sort()

  const dx = primitive.end.x - primitive.start.x
  const dy = primitive.end.y - primitive.start.y
  const lengthSquared = dx * dx + dy * dy
  const projection =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((portPoint.x - primitive.start.x) * dx +
              (portPoint.y - primitive.start.y) * dy) /
              lengthSquared,
          ),
        )
  const assignment: PreloadedTracePortAssignment = {
    traceId: primitive.traceId,
    fixedNetId: primitive.fixedNetId,
    routePosition:
      primitive.routePositionStart +
      projection * (primitive.routePositionEnd - primitive.routePositionStart),
    tracePoint: {
      x: primitive.start.x + projection * dx,
      y: primitive.start.y + projection * dy,
    },
    z,
  }
  if (primitive.isFixed === true) assignment.isFixed = true
  const existingAssignments = portPoint._preloadedTracePortAssignments ?? []
  if (
    !existingAssignments.some(
      (existing) =>
        existing.traceId === assignment.traceId &&
        existing.fixedNetId === assignment.fixedNetId &&
        existing.z === assignment.z &&
        Math.abs(existing.routePosition - assignment.routePosition) <=
          PRELOADED_TRACE_TOLERANCE,
    )
  ) {
    portPoint._preloadedTracePortAssignments = [
      ...existingAssignments,
      assignment,
    ].sort(
      (left, right) =>
        left.traceId.localeCompare(right.traceId) ||
        left.routePosition - right.routePosition ||
        left.z - right.z,
    )
  }
}

/** Fixed copper reserves its exact crossing. Movable copper uses the nearest available port. */
export function assignPreloadedTraceToBoundary({
  segment,
  primitive,
}: Pick<BoundaryCrossing, "segment" | "primitive">): void {
  for (const z of primitive.zLayers) {
    if (!segment.availableZ.includes(z)) continue
    const crossing = { segment, primitive, z }
    const portPoint = primitive.isFixed
      ? getFixedTracePortPoint(crossing)
      : getClosestPortPoint(crossing)
    if (portPoint) assignPreloadedPort({ portPoint, primitive, z })
  }
}
