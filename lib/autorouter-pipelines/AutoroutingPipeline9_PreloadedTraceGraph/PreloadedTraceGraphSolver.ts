import { pointToSegmentDistance } from "@tscircuit/math-utils"
import Flatbush from "flatbush"
import type {
  OrdinaryPortAvailability,
  PreloadedTracePortAssignment,
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

type Point = { x: number; y: number }
type RoutePoint = SimplifiedPcbTrace["route"][number]
type WireRoutePoint = Extract<RoutePoint, { route_type: "wire" }>
type ViaRoutePoint = Extract<RoutePoint, { route_type: "via" }>

type PreloadedTracePrimitive = {
  traceId: string
  fixedNetId: string
  isFixed?: boolean
  connectionName: string
  routePositionStart: number
  routePositionEnd: number
  zLayers: number[]
  copperWidth: number
  start: Point
  end: Point
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

const getPreloadedViaLayers = ({
  via,
  srj,
}: {
  via: ViaRoutePoint
  srj: Pick<SimpleRouteJson, "layerCount" | "allowBlindAndBuriedVias">
}): number[] => {
  if (srj.allowBlindAndBuriedVias !== true) {
    return Array.from({ length: srj.layerCount }, (_, z) => z)
  }
  if (via.layers !== undefined) {
    return via.layers.map((layer) => mapLayerNameToZ(layer, srj.layerCount))
  }
  return getLayersBetween(via.from_layer, via.to_layer, srj.layerCount)
}

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
          isFixed: trace.isFixed,
          connectionName: trace.connection_name,
          routePositionStart: routePosition,
          routePositionEnd: routePosition,
          zLayers: getPreloadedViaLayers({ via: routePoint, srj }),
          copperWidth: routePoint.via_diameter ?? srj.minViaDiameter ?? 0.45,
          start: routePoint,
          end: routePoint,
        })
      } else if (routePoint.route_type === "through_obstacle") {
        primitives.push({
          traceId: trace.pcb_trace_id,
          fixedNetId,
          isFixed: trace.isFixed,
          connectionName: trace.connection_name,
          routePositionStart: routePosition,
          routePositionEnd: routePosition + 1,
          zLayers: getLayersBetween(
            routePoint.from_layer,
            routePoint.to_layer,
            srj.layerCount,
          ),
          copperWidth: srj.minTraceWidth,
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
            isFixed: trace.isFixed,
            connectionName: trace.connection_name,
            routePositionStart: routePosition + padIndex,
            routePositionEnd: routePosition + padIndex,
            zLayers: [z],
            copperWidth: srj.minTraceWidth,
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
        isFixed: trace.isFixed,
        connectionName: trace.connection_name,
        routePositionStart: pointIndex,
        routePositionEnd: pointIndex + 1,
        zLayers: [mapLayerNameToZ(start.layer, srj.layerCount)],
        copperWidth: start.width,
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
  if (primitive.isFixed === true) assignment.isFixed = true
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

/** Restore an actual retained crossing omitted by generic port spacing. */
const createRetainedCrossingPort = (
  segment: SharedEdgeSegment,
  primitive: PreloadedTracePrimitive,
  z: number,
): SegmentPortPoint | undefined => {
  const dx = primitive.end.x - primitive.start.x
  const dy = primitive.end.y - primitive.start.y
  const edgeDx = segment.end.x - segment.start.x
  const edgeDy = segment.end.y - segment.start.y
  const denominator = dx * edgeDy - dy * edgeDx
  // A via or copper running along the boundary has no transverse crossing.
  if (Math.abs(denominator) < 1e-12) return undefined
  const offsetX = segment.start.x - primitive.start.x
  const offsetY = segment.start.y - primitive.start.y
  const t = (offsetX * edgeDy - offsetY * edgeDx) / denominator
  const u = (offsetX * dy - offsetY * dx) / denominator
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined
  const x = primitive.start.x + t * dx
  const y = primitive.start.y + t * dy
  const port: SegmentPortPoint = {
    segmentPortPointId: `${segment.edgeId}_retained${segment.portPoints.length}_z${z}`,
    x,
    y,
    availableZ: [z],
    nodeIds: segment.nodeIds,
    edgeId: segment.edgeId,
    connectionName: null,
    distToCentermostPortOnZ: Math.hypot(
      x - (segment.start.x + segment.end.x) / 2,
      y - (segment.start.y + segment.end.y) / 2,
    ),
    cramped: false,
  }
  segment.portPoints.push(port)
  return port
}

/**
 * Loads retained copper onto capacity-graph boundary ports, restoring actual
 * crossings where generic spacing omitted all ports on a short edge. Explicitly
 * immutable copper also reserves nearby port layers for physical clearance;
 * capacity regions and obstacle geometry are unchanged.
 */
export class PreloadedTraceGraphSolver extends BaseSolver {
  private readonly primitives: PreloadedTracePrimitive[]
  private readonly boundaryIndex: Flatbush | null

  constructor(
    private readonly sharedEdgeSegments: SharedEdgeSegment[],
    private readonly srj: SimpleRouteJson,
  ) {
    super()
    this.MAX_ITERATIONS = 1
    this.primitives = getPreloadedTracePrimitives(srj)
    this.boundaryIndex =
      sharedEdgeSegments.length > 0
        ? new Flatbush(sharedEdgeSegments.length)
        : null
    if (this.boundaryIndex) {
      for (const segment of sharedEdgeSegments) {
        this.boundaryIndex.add(
          Math.min(segment.start.x, segment.end.x),
          Math.min(segment.start.y, segment.end.y),
          Math.max(segment.start.x, segment.end.x),
          Math.max(segment.start.y, segment.end.y),
        )
      }
      this.boundaryIndex.finish()
    }
  }

  override getSolverName(): string {
    return "PreloadedTraceGraphSolver"
  }

  override _step(): void {
    const inputPortCount = this.sharedEdgeSegments.reduce(
      (count, segment) => count + segment.portPoints.length,
      0,
    )
    let boundaryDistanceCheckCount: number = 0
    for (const primitive of this.primitives) {
      if (this.boundaryIndex === null) break
      // Include near misses accepted by the exact geometric predicate. Keep
      // boundary order stable: competing fixed-net assignments are ordered.
      const candidates: number[] = this.boundaryIndex
        .search(
          Math.min(primitive.start.x, primitive.end.x) - GEOMETRIC_TOLERANCE,
          Math.min(primitive.start.y, primitive.end.y) - GEOMETRIC_TOLERANCE,
          Math.max(primitive.start.x, primitive.end.x) + GEOMETRIC_TOLERANCE,
          Math.max(primitive.start.y, primitive.end.y) + GEOMETRIC_TOLERANCE,
        )
        .sort((left, right) => left - right)
      for (const index of candidates) {
        const segment = this.sharedEdgeSegments[index]!
        boundaryDistanceCheckCount++
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
        const dx = primitive.end.x - primitive.start.x
        const dy = primitive.end.y - primitive.start.y
        // A wire along an edge occupies copper, but does not cross that edge.
        // Treating it as a crossing projects several unrelated boundary ports
        // onto its centerline and can serialize a false out-and-back section.
        if (
          (dx !== 0 || dy !== 0) &&
          Math.abs(
            dx * (segment.end.y - segment.start.y) -
              dy * (segment.end.x - segment.start.x),
          ) < 1e-12
        )
          continue

        for (const z of primitive.zLayers) {
          if (!segment.availableZ.includes(z)) continue
          const portPoint =
            getClosestPortPoint(segment, primitive, z) ??
            createRetainedCrossingPort(segment, primitive, z)
          if (portPoint) preloadPort(portPoint, primitive, z)
        }
      }
    }

    // Explicitly immutable copper reserves its physical clearance on graph
    // ports, including edges it runs beside without crossing. Movable preload
    // geometry remains graph occupancy and is never converted into obstacles.
    let fixedClearancePortLayerCount = 0
    for (const primitive of this.primitives) {
      if (primitive.isFixed !== true || this.boundaryIndex === null) continue
      const radius =
        (primitive.copperWidth + this.srj.minTraceWidth) / 2 +
        (this.srj.minTraceToPadEdgeClearance ?? 0.1) +
        GEOMETRIC_TOLERANCE
      const candidates = this.boundaryIndex.search(
        Math.min(primitive.start.x, primitive.end.x) - radius,
        Math.min(primitive.start.y, primitive.end.y) - radius,
        Math.max(primitive.start.x, primitive.end.x) + radius,
        Math.max(primitive.start.y, primitive.end.y) + radius,
      )
      for (const index of candidates) {
        for (const port of this.sharedEdgeSegments[index]!.portPoints) {
          if (
            pointToSegmentDistance(port, primitive.start, primitive.end) >=
            radius
          )
            continue
          port.availableZ = port.availableZ.filter((z) => {
            if (!primitive.zLayers.includes(z)) return true
            // Keep retained crossings available to the demand pass, which may
            // allocate neighboring slots beside this copper. The physical
            // capacity pass reserves the original crossing for its fixed net.
            if (
              port._preloadedTracePortAssignments?.some(
                (assignment) =>
                  assignment.z === z &&
                  assignment.fixedNetId === primitive.fixedNetId,
              )
            )
              return true
            // Nearby fixed copper forbids foreign nets, but its owner may
            // branch into it without crossing this boundary's centerline.
            // Intersect restrictions when more than one fixed net is nearby.
            const allowed = port.clearanceAllowedNetIdsByZ?.[z]
            const nextAllowed = allowed
              ? allowed.filter((net) => net === primitive.fixedNetId)
              : [primitive.fixedNetId]
            port.clearanceAllowedNetIdsByZ ??= {}
            port.clearanceAllowedNetIdsByZ[z] = nextAllowed
            fixedClearancePortLayerCount++
            if (nextAllowed.length > 0) return true
            return false
          })
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
      boundaryDistanceCheckCount,
      fixedClearancePortLayerCount,
      preloadedTraceCount: this.srj.traces?.length ?? 0,
      preloadedTraceShapeCount: this.primitives.length,
      inputBoundaryCount: this.sharedEdgeSegments.length,
      outputBoundaryCount: this.sharedEdgeSegments.length,
      inputPortCount,
      outputPortCount: portPoints.length,
      preloadedPortCount: preloadedPortPoints.length,
      tracePortAssignmentCount: preloadedPortPoints.reduce(
        (count, portPoint) =>
          count + (portPoint._preloadedTracePortAssignments?.length ?? 0),
        0,
      ),
      restoredCrossingPortCount: portPoints.length - inputPortCount,
      topologyChanged:
        fixedClearancePortLayerCount > 0 || portPoints.length > inputPortCount,
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

/** Terminal escape pruning must see the same immutable copper as path planning.
 * Keep movable routes negotiable; never turn retained traces into obstacles.
 */
export const createFixedTracePortAvailability = (
  srj: SimpleRouteJson,
): OrdinaryPortAvailability | undefined => {
  const primitives = getPreloadedTracePrimitives(srj).filter(
    (primitive) => primitive.isFixed === true,
  )
  if (primitives.length === 0) return undefined
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const clearance = srj.minTraceToPadEdgeClearance ?? 0.1
  const index = new Flatbush(primitives.length)
  for (const primitive of primitives) {
    const radius = (primitive.copperWidth + srj.minTraceWidth) / 2 + clearance
    index.add(
      Math.min(primitive.start.x, primitive.end.x) - radius,
      Math.min(primitive.start.y, primitive.end.y) - radius,
      Math.max(primitive.start.x, primitive.end.x) + radius,
      Math.max(primitive.start.y, primitive.end.y) + radius,
    )
  }
  index.finish()
  const blockedNetsByPort = new WeakMap<
    SegmentPortPoint,
    Map<number, Set<string>>
  >()
  return (port, target): boolean => {
    let blockedByLayer = blockedNetsByPort.get(port)
    if (!blockedByLayer) {
      blockedByLayer = new Map()
      for (const candidate of index.search(port.x, port.y, port.x, port.y)) {
        const primitive = primitives[candidate]!
        const radius =
          (primitive.copperWidth + srj.minTraceWidth) / 2 + clearance
        if (
          pointToSegmentDistance(port, primitive.start, primitive.end) >=
          radius - GEOMETRIC_TOLERANCE
        )
          continue
        for (const z of primitive.zLayers) {
          const nets = blockedByLayer.get(z) ?? new Set<string>()
          nets.add(primitive.fixedNetId)
          blockedByLayer.set(z, nets)
        }
      }
      blockedNetsByPort.set(port, blockedByLayer)
    }
    const targetNets = new Set(
      (target._connectedTo ?? []).map(
        (id) => connMap.getNetConnectedToId(id) ?? id,
      ),
    )
    return port.availableZ.some((z) =>
      [...(blockedByLayer!.get(z) ?? [])].every((net) => targetNets.has(net)),
    )
  }
}
