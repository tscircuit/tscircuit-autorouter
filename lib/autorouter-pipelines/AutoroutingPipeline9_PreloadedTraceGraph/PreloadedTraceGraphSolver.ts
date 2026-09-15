import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  PreloadedTracePortAssignment,
  SharedEdgeSegment,
  SegmentPortPoint,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

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
  clearanceRadius: number
  blocksNearbyPorts: boolean
}

const GEOMETRIC_TOLERANCE = 1e-6

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
  const newTraceRadius = srj.minTraceWidth / 2
  const traceClearance =
    srj.minTraceToPadEdgeClearance ?? srj.defaultObstacleMargin ?? 0.15

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
          clearanceRadius:
            (routePoint.via_diameter ?? srj.minTraceWidth) / 2 +
            newTraceRadius +
            traceClearance,
          blocksNearbyPorts: true,
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
          clearanceRadius:
            routePoint.width / 2 + newTraceRadius + traceClearance,
          blocksNearbyPorts: true,
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
            clearanceRadius: newTraceRadius * 2 + traceClearance,
            blocksNearbyPorts: true,
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
        clearanceRadius:
          Math.max(start.width, end.width) / 2 +
          newTraceRadius +
          traceClearance,
        blocksNearbyPorts: false,
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
 * Loads fixed copper onto existing capacity-graph boundary ports and marks
 * nearby ports unavailable when they cannot provide trace clearance. Capacity
 * regions, edges, and ports are never added or removed.
 */
export class PreloadedTraceGraphSolver extends BaseSolver {
  private readonly primitives: PreloadedTracePrimitive[]

  constructor(
    private readonly sharedEdgeSegments: SharedEdgeSegment[],
    private readonly srj: SimpleRouteJson,
  ) {
    super()
    this.MAX_ITERATIONS = 1
    this.primitives = getPreloadedTracePrimitives(srj)
  }

  override getSolverName(): string {
    return "PreloadedTraceGraphSolver"
  }

  override _step(): void {
    const clearanceBlockedPortIds = new Set<string>()
    const clearanceBlockedPortIdsBySegmentLayer = new Map<string, Set<string>>()
    for (const primitive of this.primitives) {
      for (const segment of this.sharedEdgeSegments) {
        const distanceToSegment = minimumDistanceBetweenSegments(
          primitive.start,
          primitive.end,
          segment.start,
          segment.end,
        )
        if (distanceToSegment > primitive.clearanceRadius) {
          continue
        }

        for (const z of primitive.zLayers) {
          if (!segment.availableZ.includes(z)) continue
          const assignedPortPoint =
            distanceToSegment <= GEOMETRIC_TOLERANCE
              ? getClosestPortPoint(segment, primitive, z)
              : undefined
          if (assignedPortPoint) preloadPort(assignedPortPoint, primitive, z)
          if (!primitive.blocksNearbyPorts) continue

          for (const portPoint of segment.portPoints) {
            if (
              !portPoint.availableZ.includes(z) ||
              pointToSegmentDistance(
                portPoint,
                primitive.start,
                primitive.end,
              ) >
                primitive.clearanceRadius + GEOMETRIC_TOLERANCE
            ) {
              continue
            }
            const segmentLayerKey = `${segment.edgeId}::${z}`
            const blockedPortIds =
              clearanceBlockedPortIdsBySegmentLayer.get(segmentLayerKey) ??
              new Set<string>()
            blockedPortIds.add(portPoint.segmentPortPointId)
            clearanceBlockedPortIdsBySegmentLayer.set(
              segmentLayerKey,
              blockedPortIds,
            )
          }
        }
      }
    }

    for (const segment of this.sharedEdgeSegments) {
      for (const z of segment.availableZ) {
        const layerPortPoints = segment.portPoints.filter((portPoint) =>
          portPoint.availableZ.includes(z),
        )
        const blockedPortIds = clearanceBlockedPortIdsBySegmentLayer.get(
          `${segment.edgeId}::${z}`,
        )
        if (layerPortPoints.length === 0 || !blockedPortIds) continue
        for (const portPoint of layerPortPoints) {
          if (!blockedPortIds.has(portPoint.segmentPortPointId)) continue
          const isAssignedToPreloadedTrace = (
            portPoint._preloadedTracePortAssignments ?? []
          ).some((assignment) => assignment.z === z)
          if (isAssignedToPreloadedTrace) continue
          portPoint._preloadedCopperBlockedZ = [
            ...new Set([...(portPoint._preloadedCopperBlockedZ ?? []), z]),
          ].sort((a, b) => a - b)
          clearanceBlockedPortIds.add(`${portPoint.segmentPortPointId}::${z}`)
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
      clearanceBlockedPortCount: clearanceBlockedPortIds.size,
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
