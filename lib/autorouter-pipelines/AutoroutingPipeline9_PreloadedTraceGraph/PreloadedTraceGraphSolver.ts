import {
  getSegmentIntersection,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import Flatbush from "flatbush"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  PreloadedTracePortAssignment,
  SharedEdgeSegment,
  SegmentPortPoint,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import {
  createPreloadedCopperLookup,
  type PreloadedCopperLookup,
} from "./createPreloadedCopperLookup"

type Point = { x: number; y: number }
type ClearanceGap = {
  key: string
  segment: SharedEdgeSegment
  port: SegmentPortPoint
  ends: [Point, Point]
}
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

const getFixedTracePortPoint = ({
  segment,
  primitive,
  z,
}: {
  segment: SharedEdgeSegment
  primitive: PreloadedTracePrimitive
  z: number
}): SegmentPortPoint | undefined => {
  const crossing = getSegmentIntersection(
    primitive.start,
    primitive.end,
    segment.start,
    segment.end,
  )
  // A collinear trace has no unique crossing along the shared edge.
  if (!crossing) return getClosestPortPoint(segment, primitive, z)

  const existing = segment.portPoints.find(
    (candidate) =>
      candidate.availableZ.includes(z) &&
      Math.hypot(candidate.x - crossing.x, candidate.y - crossing.y) <
        GEOMETRIC_TOLERANCE,
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

/**
 * Loads saved copper onto capacity-graph boundary ports. Empty clearance gaps
 * receive crossing ports without changing the mesh regions or trace geometry.
 */
export class PreloadedTraceGraphSolver extends BaseSolver {
  private readonly primitives: PreloadedTracePrimitive[]
  private readonly clearanceGaps = new Map<string, ClearanceGap>()
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

        for (const z of primitive.zLayers) {
          if (!segment.availableZ.includes(z)) continue
          let portPoint: SegmentPortPoint | undefined
          if (primitive.isFixed) {
            portPoint = getFixedTracePortPoint({ segment, primitive, z })
          } else {
            portPoint = getClosestPortPoint(segment, primitive, z)
          }
          if (portPoint) preloadPort(portPoint, primitive, z)
        }
      }
    }

    this.addClearanceGapPorts()
    const portPoints = this.sharedEdgeSegments.flatMap(
      (segment) => segment.portPoints,
    )
    const preloadedPortPoints = portPoints.filter(
      (portPoint) => (portPoint._preloadedFixedNetIds?.length ?? 0) > 0,
    )
    this.stats = {
      boundaryDistanceCheckCount,
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
      topologyChanged: portPoints.length !== inputPortCount,
    }
    this.solved = true
  }

  private addClearanceGapPorts(): void {
    if (!this.srj.traces?.some((trace) => trace.isFixed)) return
    const copperLookup = createPreloadedCopperLookup({
      srj: this.srj,
      connMap: getConnectivityMapFromSimpleRouteJson(this.srj),
      traceWidth: this.srj.minTraceWidth,
      viaDiameter: this.srj.minViaDiameter ?? 0.3,
    })
    for (const segment of this.sharedEdgeSegments) {
      for (const z of segment.availableZ) {
        this.addLayerClearanceGapPorts({ segment, z, copperLookup })
      }
    }
  }

  private addLayerClearanceGapPorts({
    segment,
    z,
    copperLookup,
  }: {
    segment: SharedEdgeSegment
    z: number
    copperLookup: PreloadedCopperLookup
  }): void {
    const dx = segment.end.x - segment.start.x
    const dy = segment.end.y - segment.start.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared === 0) return
    const length = Math.sqrt(lengthSquared)
    const layerPorts = segment.portPoints.filter((port) =>
      port.availableZ.includes(z),
    )
    const template = layerPorts[0]
    if (!template) return
    const freePortFractions = layerPorts
      .filter((port) => !port._preloadedTracePortAssignments?.length)
      .map(
        (port) =>
          ((port.x - segment.start.x) * dx + (port.y - segment.start.y) * dy) /
          lengthSquared,
      )
    const clearSpans = copperLookup.getClearSpans({ ...segment, z })
    for (const [index, [start, end]] of clearSpans.entries()) {
      if ((end - start) * length <= GEOMETRIC_TOLERANCE) continue
      const hasFreePort = freePortFractions.some(
        (fraction) => fraction > start + 1e-9 && fraction < end - 1e-9,
      )
      if (hasFreePort) continue
      const fraction = (start + end) / 2
      const port: SegmentPortPoint = {
        ...template,
        segmentPortPointId: `${segment.edgeId}_preloadgap${index}_z${z}`,
        x: segment.start.x + dx * fraction,
        y: segment.start.y + dy * fraction,
        availableZ: [z],
        connectionName: null,
        rootConnectionName: undefined,
        _preloadedFixedNetIds: undefined,
        _preloadedTracePortAssignments: undefined,
        distToCentermostPortOnZ: Math.abs(fraction - 0.5) * length,
      }
      segment.portPoints.push(port)
      const ends: [Point, Point] = [
        { x: segment.start.x + dx * start, y: segment.start.y + dy * start },
        { x: segment.start.x + dx * end, y: segment.start.y + dy * end },
      ]
      this.clearanceGaps.set(`${port.segmentPortPointId}::${z}`, {
        // Mesh refinement can renumber edges. Match the same physical gap.
        key: JSON.stringify([segment.nodeIds, z, ends]),
        segment,
        port,
        ends,
      })
    }
  }

  removeOverlappingGapPorts({
    nodes,
    connMap,
    excludedSites,
  }: {
    nodes: NodeWithPortPoints[]
    connMap: ConnectivityMap
    excludedSites: Set<string>
  }): boolean {
    if (this.clearanceGaps.size < 2) return false
    const assigned = new Map<string, { gap: ClearanceGap; net: string }>()
    for (const node of nodes) {
      for (const point of node.portPoints) {
        if (!point.portPointId || assigned.has(point.portPointId)) continue
        const gap = this.clearanceGaps.get(point.portPointId)
        if (!gap) continue
        const name = point.rootConnectionName ?? point.connectionName
        assigned.set(point.portPointId, {
          gap,
          net: connMap.getNetConnectedToId(name) ?? name,
        })
      }
    }
    if (assigned.size < 2) return false
    const crossings = [...assigned.values()]
    const index = new Flatbush(crossings.length)
    for (const {
      gap: { port },
    } of crossings) {
      index.add(port.x, port.y, port.x, port.y)
    }
    index.finish()
    const clearance =
      this.srj.minTraceToPadEdgeClearance ??
      this.srj.defaultObstacleMargin ??
      RELAXED_DRC_OPTIONS.traceClearance
    const pitch = this.srj.minTraceWidth + clearance
    const previousCount = excludedSites.size
    for (const [i, { gap, net }] of crossings.entries()) {
      const { x, y, availableZ } = gap.port
      const neighbors = index.search(x - pitch, y - pitch, x + pitch, y + pitch)
      const conflicts = neighbors.some((j) => {
        if (j >= i) return false
        const other = crossings[j]!
        if (
          net === other.net ||
          availableZ[0] !== other.gap.port.availableZ[0] ||
          excludedSites.has(other.gap.key)
        ) {
          return false
        }
        // The farthest two points on these straight spans are endpoints. If
        // even they are too close, moving the planned crossings cannot help.
        return gap.ends.every((a) =>
          other.gap.ends.every(
            (b) =>
              Math.hypot(a.x - b.x, a.y - b.y) < pitch - GEOMETRIC_TOLERANCE,
          ),
        )
      })
      if (conflicts) excludedSites.add(gap.key)
    }
    if (excludedSites.size === previousCount) return false
    this.removeExcludedGapPorts(excludedSites)
    return true
  }

  removeExcludedGapPorts(excludedSites: ReadonlySet<string>): void {
    if (excludedSites.size === 0) return
    for (const [id, gap] of this.clearanceGaps) {
      if (!excludedSites.has(gap.key)) continue
      gap.segment.portPoints = gap.segment.portPoints.filter(
        (port) => port !== gap.port,
      )
      this.clearanceGaps.delete(id)
    }
  }

  getOutput(): SharedEdgeSegment[] {
    if (!this.solved) {
      throw new Error("PreloadedTraceGraphSolver has not solved yet")
    }
    return this.sharedEdgeSegments
  }
}
