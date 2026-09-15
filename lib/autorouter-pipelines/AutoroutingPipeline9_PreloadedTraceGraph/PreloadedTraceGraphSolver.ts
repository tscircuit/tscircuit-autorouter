import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  PreloadedCopperPortReservation,
  PreloadedTracePortAssignment,
  SharedEdgeSegment,
  SegmentPortPoint,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getKeepoutCoordinateInterval } from "lib/solvers/UniformPortDistributionSolver/getKeepoutCoordinateInterval"
import type {
  BoundaryPortKeepout,
  CoordinateInterval,
  OwnerPairKey,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { getPipeline9BoundaryPortKeepouts } from "./getPipeline9BoundaryPortKeepouts"

type Point = { x: number; y: number }
type RoutePoint = SimplifiedPcbTrace["route"][number]
type WireRoutePoint = Extract<RoutePoint, { route_type: "wire" }>

type PreloadedTracePrimitive = {
  traceId: string
  fixedNetId: string
  connectionName: string
  routePositionStart: number
  routePositionEnd: number
  zLayers: number[]
  start: Point
  end: Point
}

const GEOMETRIC_TOLERANCE = 1e-6

type KeepoutIntervalWithNetIds = CoordinateInterval & {
  keepout: BoundaryPortKeepout
  netIds: string[]
  portPathingReservation: BoundaryPortKeepout["portPathingReservation"]
}

const deduplicateCopperReservations = (
  reservations: PreloadedCopperPortReservation[],
) =>
  reservations.filter(
    (reservation, reservationIndex) =>
      reservations.findIndex(
        (candidate) =>
          candidate.keepoutId === reservation.keepoutId &&
          candidate.netId === reservation.netId,
      ) === reservationIndex,
  )

const reservePortPointForCopper = ({
  portPoint,
  z,
  reservations,
}: {
  portPoint: SegmentPortPoint
  z: number
  reservations: PreloadedCopperPortReservation[]
}) => {
  const existingLayerReservations =
    portPoint._preloadedCopperReservationsByZ?.find(
      (reservation) => reservation.z === z,
    )
  if (existingLayerReservations) {
    existingLayerReservations.reservations = deduplicateCopperReservations([
      ...existingLayerReservations.reservations,
      ...reservations,
    ])
    return
  }
  portPoint._preloadedCopperReservationsByZ = [
    ...(portPoint._preloadedCopperReservationsByZ ?? []),
    { z, reservations: deduplicateCopperReservations(reservations) },
  ].sort((left, right) => left.z - right.z)
}

const getFullyBlockedEdgeIntervals = ({
  edgeMin,
  edgeMax,
  intervals,
}: {
  edgeMin: number
  edgeMax: number
  intervals: KeepoutIntervalWithNetIds[]
}): KeepoutIntervalWithNetIds[] => {
  const sortedIntervals = [...intervals].sort(
    (left, right) => left.min - right.min || left.max - right.max,
  )
  let coveredThrough = edgeMin
  for (const interval of sortedIntervals) {
    if (interval.min > coveredThrough + GEOMETRIC_TOLERANCE) break
    coveredThrough = Math.max(coveredThrough, interval.max)
    if (coveredThrough >= edgeMax - GEOMETRIC_TOLERANCE) {
      return intervals
    }
  }
  return []
}

const getPointOnSharedEdge = (sharedEdge: SharedEdge, coordinate: number) =>
  sharedEdge.orientation === "horizontal"
    ? { x: coordinate, y: sharedEdge.y1 }
    : { x: sharedEdge.x1, y: coordinate }

const getRelevantPreloadedTraceSection = ({
  keepout,
  sharedEdge,
  coordinateMin,
  coordinateMax,
}: {
  keepout: BoundaryPortKeepout
  sharedEdge: SharedEdge
  coordinateMin: number
  coordinateMax: number
}) => {
  const sourceSection = keepout.removablePreloadedTraceSection
  if (!sourceSection || keepout.shape !== "capsule") return sourceSection
  const dx = keepout.end.x - keepout.start.x
  const dy = keepout.end.y - keepout.start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= GEOMETRIC_TOLERANCE * GEOMETRIC_TOLERANCE) {
    return sourceSection
  }
  const getProjectedRoutePosition = (coordinate: number) => {
    const point = getPointOnSharedEdge(sharedEdge, coordinate)
    const projection = Math.max(
      0,
      Math.min(
        1,
        ((point.x - keepout.start.x) * dx + (point.y - keepout.start.y) * dy) /
          lengthSquared,
      ),
    )
    return (
      sourceSection.startRoutePosition +
      projection *
        (sourceSection.endRoutePosition - sourceSection.startRoutePosition)
    )
  }
  const firstRoutePosition = getProjectedRoutePosition(coordinateMin)
  const secondRoutePosition = getProjectedRoutePosition(coordinateMax)
  return {
    traceId: sourceSection.traceId,
    startRoutePosition: Math.min(firstRoutePosition, secondRoutePosition),
    endRoutePosition: Math.max(firstRoutePosition, secondRoutePosition),
  }
}

const getCopperReservationsForCoordinateRange = ({
  interval,
  sharedEdge,
  coordinateMin,
  coordinateMax,
}: {
  interval: KeepoutIntervalWithNetIds
  sharedEdge: SharedEdge
  coordinateMin: number
  coordinateMax: number
}): PreloadedCopperPortReservation[] =>
  interval.netIds.map((netId) => ({
    keepoutId: interval.keepout.keepoutId,
    netId,
    removablePreloadedTraceSection: getRelevantPreloadedTraceSection({
      keepout: interval.keepout,
      sharedEdge,
      coordinateMin,
      coordinateMax,
    }),
  }))

const getLayersBetween = (
  fromLayer: string,
  toLayer: string,
  layerCount: number,
): number[] => {
  const fromZ = mapLayerNameToZ(fromLayer, layerCount)
  const toZ = mapLayerNameToZ(toLayer, layerCount)
  return Array.from(
    { length: Math.abs(toZ - fromZ) + 1 },
    (_, index) => Math.min(fromZ, toZ) + index,
  )
}

const isWireRoutePoint = (point: RoutePoint): point is WireRoutePoint =>
  point.route_type === "wire"

const getPreloadedTracePrimitives = (
  srj: SimpleRouteJson,
): PreloadedTracePrimitive[] => {
  const primitives: PreloadedTracePrimitive[] = []
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)

  for (const trace of srj.traces ?? []) {
    if (!trace.connection_name) {
      throw new Error(
        `Preloaded trace "${trace.pcb_trace_id}" is missing a connection name`,
      )
    }
    const fixedNetId =
      connMap.getNetConnectedToId(trace.connection_name) ??
      trace.connection_name

    for (const [routePosition, routePoint] of trace.route.entries()) {
      if (routePoint.route_type === "via") {
        primitives.push({
          traceId: trace.pcb_trace_id,
          fixedNetId,
          connectionName: trace.connection_name,
          routePositionStart: routePosition,
          routePositionEnd: routePosition,
          zLayers: getLayersBetween(
            routePoint.from_layer,
            routePoint.to_layer,
            srj.layerCount,
          ),
          start: routePoint,
          end: routePoint,
        })
      } else if (routePoint.route_type === "through_obstacle") {
        primitives.push({
          traceId: trace.pcb_trace_id,
          fixedNetId,
          connectionName: trace.connection_name,
          routePositionStart: routePosition,
          routePositionEnd: routePosition + 1,
          zLayers: getLayersBetween(
            routePoint.from_layer,
            routePoint.to_layer,
            srj.layerCount,
          ),
          start: routePoint.start,
          end: routePoint.end,
        })
      } else if (routePoint.route_type === "jumper") {
        const z = mapLayerNameToZ(routePoint.layer, srj.layerCount)
        for (const [padIndex, padCenter] of [
          routePoint.start,
          routePoint.end,
        ].entries()) {
          primitives.push({
            traceId: trace.pcb_trace_id,
            fixedNetId,
            connectionName: trace.connection_name,
            routePositionStart: routePosition + padIndex,
            routePositionEnd: routePosition + padIndex,
            zLayers: [z],
            start: padCenter,
            end: padCenter,
          })
        }
      }
    }

    for (
      let pointIndex = 0;
      pointIndex < trace.route.length - 1;
      pointIndex++
    ) {
      const start = trace.route[pointIndex]!
      const end = trace.route[pointIndex + 1]!
      if (
        !isWireRoutePoint(start) ||
        !isWireRoutePoint(end) ||
        start.layer !== end.layer
      ) {
        continue
      }
      primitives.push({
        traceId: trace.pcb_trace_id,
        fixedNetId,
        connectionName: trace.connection_name,
        routePositionStart: pointIndex,
        routePositionEnd: pointIndex + 1,
        zLayers: [mapLayerNameToZ(start.layer, srj.layerCount)],
        start,
        end,
      })
    }
  }

  return primitives
}

const getClosestPortPoint = (
  segment: SharedEdgeSegment,
  primitive: PreloadedTracePrimitive,
  z: number,
): SegmentPortPoint | undefined =>
  segment.portPoints
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

const preloadPort = (
  portPoint: SegmentPortPoint,
  primitive: PreloadedTracePrimitive,
  z: number,
) => {
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
  const existingAssignments = portPoint._preloadedTracePortAssignments ?? []
  if (
    !existingAssignments.some(
      (existing) =>
        existing.traceId === assignment.traceId &&
        existing.fixedNetId === assignment.fixedNetId &&
        existing.z === assignment.z &&
        Math.abs(existing.routePosition - assignment.routePosition) <=
          GEOMETRIC_TOLERANCE,
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

/**
 * Loads fixed copper onto existing capacity-graph boundary ports. Capacity
 * regions, edges, and ports are never added or removed.
 */
export class PreloadedTraceGraphSolver extends BaseSolver {
  private readonly primitives: PreloadedTracePrimitive[]
  private readonly copperKeepouts: BoundaryPortKeepout[]

  constructor(
    private readonly sharedEdgeSegments: SharedEdgeSegment[],
    private readonly srj: SimpleRouteJson,
  ) {
    super()
    this.MAX_ITERATIONS = 1
    this.primitives = getPreloadedTracePrimitives(srj)
    this.copperKeepouts = getPipeline9BoundaryPortKeepouts({
      srj,
      connMap: getConnectivityMapFromSimpleRouteJson(srj),
      changedPreloadedTraceSections: [],
      defaultViaDiameter: getViaDimensions(srj).padDiameter,
    })
  }

  override getSolverName(): string {
    return "PreloadedTraceGraphSolver"
  }

  override _step(): void {
    for (const primitive of this.primitives) {
      for (const segment of this.sharedEdgeSegments) {
        if (
          minimumDistanceBetweenSegments(
            primitive.start,
            primitive.end,
            segment.start,
            segment.end,
          ) > GEOMETRIC_TOLERANCE
        ) {
          continue
        }

        for (const z of primitive.zLayers) {
          if (!segment.availableZ.includes(z)) continue
          const portPoint = getClosestPortPoint(segment, primitive, z)
          if (portPoint) preloadPort(portPoint, primitive, z)
        }
      }
    }

    const connMap = getConnectivityMapFromSimpleRouteJson(this.srj)
    const traceClearance =
      this.srj.minTraceToPadEdgeClearance ??
      this.srj.defaultObstacleMargin ??
      0.15
    const keepoutPortIds = new Set<string>()
    for (const segment of this.sharedEdgeSegments) {
      const isHorizontal =
        Math.abs(segment.end.x - segment.start.x) >=
        Math.abs(segment.end.y - segment.start.y)
      const sharedEdge: SharedEdge = {
        ownerNodeIds: segment.nodeIds,
        ownerPairKey: segment.edgeId as OwnerPairKey,
        orientation: isHorizontal ? "horizontal" : "vertical",
        x1: segment.start.x,
        y1: segment.start.y,
        x2: segment.end.x,
        y2: segment.end.y,
        center: {
          x: (segment.start.x + segment.end.x) / 2,
          y: (segment.start.y + segment.end.y) / 2,
        },
        length: Math.hypot(
          segment.end.x - segment.start.x,
          segment.end.y - segment.start.y,
        ),
        nodeSideByOwnerId: {},
      }
      const edgeMin = isHorizontal
        ? Math.min(segment.start.x, segment.end.x)
        : Math.min(segment.start.y, segment.end.y)
      const edgeMax = isHorizontal
        ? Math.max(segment.start.x, segment.end.x)
        : Math.max(segment.start.y, segment.end.y)

      for (const z of segment.availableZ) {
        const keepoutIntervals = this.copperKeepouts.flatMap(
          (keepout): KeepoutIntervalWithNetIds[] => {
            if (keepout.z !== z) return []
            const interval = getKeepoutCoordinateInterval({
              sharedEdge,
              keepout,
              traceRadius: this.srj.minTraceWidth / 2,
              clearance: traceClearance,
            })
            if (!interval) return []
            return [
              {
                ...interval,
                keepout,
                netIds: keepout.connectedTo.map(
                  (connectionId) =>
                    connMap.getNetConnectedToId(connectionId) ?? connectionId,
                ),
                portPathingReservation: keepout.portPathingReservation,
              },
            ]
          },
        )
        const fullyBlockingIntervals = getFullyBlockedEdgeIntervals({
          edgeMin,
          edgeMax,
          intervals: keepoutIntervals.filter(
            ({ portPathingReservation }) =>
              portPathingReservation === "full-edge",
          ),
        })

        for (const portPoint of segment.portPoints) {
          if (!portPoint.availableZ.includes(z)) continue
          const coordinate = isHorizontal ? portPoint.x : portPoint.y
          const sampledCoordinateReservations = keepoutIntervals.flatMap(
            (interval) =>
              interval.portPathingReservation === "sampled-coordinate" &&
              coordinate >= interval.min &&
              coordinate <= interval.max
                ? getCopperReservationsForCoordinateRange({
                    interval,
                    sharedEdge,
                    coordinateMin: coordinate,
                    coordinateMax: coordinate,
                  })
                : [],
          )
          const reservations = deduplicateCopperReservations([
            ...fullyBlockingIntervals.flatMap((interval) =>
              getCopperReservationsForCoordinateRange({
                interval,
                sharedEdge,
                coordinateMin: Math.max(edgeMin, interval.min),
                coordinateMax: Math.min(edgeMax, interval.max),
              }),
            ),
            ...sampledCoordinateReservations,
          ])
          if (reservations.length === 0) continue
          reservePortPointForCopper({ portPoint, z, reservations })
          keepoutPortIds.add(`${portPoint.segmentPortPointId}::${z}`)
        }
      }
    }

    const portPoints = this.sharedEdgeSegments.flatMap(
      (segment) => segment.portPoints,
    )
    const preloadedPortPoints = portPoints.filter(
      (portPoint) => (portPoint._preloadedFixedNetIds?.length ?? 0) > 0,
    )
    this.stats = {
      preloadedTraceCount: this.srj.traces?.length ?? 0,
      preloadedTraceShapeCount: this.primitives.length,
      inputBoundaryCount: this.sharedEdgeSegments.length,
      outputBoundaryCount: this.sharedEdgeSegments.length,
      inputPortCount: portPoints.length,
      outputPortCount: portPoints.length,
      preloadedPortCount: preloadedPortPoints.length,
      tracePortAssignmentCount: preloadedPortPoints.reduce(
        (count, portPoint) =>
          count + (portPoint._preloadedTracePortAssignments?.length ?? 0),
        0,
      ),
      fixedCopperKeepoutPortCount: keepoutPortIds.size,
      topologyChanged: false,
    }
    this.solved = true
  }

  getOutput(): SharedEdgeSegment[] {
    if (!this.solved) {
      throw new Error("PreloadedTraceGraphSolver has not solved yet")
    }
    return this.sharedEdgeSegments
  }
}
