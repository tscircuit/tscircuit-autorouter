import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  SharedEdgeSegment,
  SegmentPortPoint,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { JUMPER_DIMENSIONS } from "lib/utils/jumperSizes"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { resolvePreloadedTraceCanonicalNetIds } from "lib/utils/resolvePreloadedTraceCanonicalNetIds"

type Point = { x: number; y: number }

type PreloadedTracePrimitive = {
  fixedNetId: string
  connectionName: string
  zLayers: number[]
  start: Point
  end: Point
  radius: number
}

type RoutePoint = SimplifiedPcbTrace["route"][number]
type WireRoutePoint = Extract<RoutePoint, { route_type: "wire" }>

const GEOMETRIC_TOLERANCE = 1e-6

const getLayersBetween = (
  fromLayer: string,
  toLayer: string,
  layerCount: number,
): number[] => {
  const fromZ = mapLayerNameToZ(fromLayer, layerCount)
  const toZ = mapLayerNameToZ(toLayer, layerCount)
  const minZ = Math.min(fromZ, toZ)
  const maxZ = Math.max(fromZ, toZ)
  return Array.from({ length: maxZ - minZ + 1 }, (_, index) => minZ + index)
}

const isWireRoutePoint = (point: RoutePoint): point is WireRoutePoint =>
  point.route_type === "wire"

const getPreloadedTracePrimitives = (
  srj: SimpleRouteJson,
): PreloadedTracePrimitive[] => {
  const primitives: PreloadedTracePrimitive[] = []
  const canonicalNetIdByTraceId = resolvePreloadedTraceCanonicalNetIds(srj)
  const defaultViaDiameter = getViaDimensions(srj).padDiameter

  for (const trace of srj.traces ?? []) {
    if (!trace.connection_name) {
      throw new Error(
        `Preloaded trace "${trace.pcb_trace_id}" is missing a connection name`,
      )
    }
    const fixedNetId =
      canonicalNetIdByTraceId.get(trace.pcb_trace_id) ?? trace.connection_name

    for (const routePoint of trace.route) {
      if (routePoint.route_type === "via") {
        primitives.push({
          fixedNetId,
          connectionName: trace.connection_name,
          zLayers: getLayersBetween(
            routePoint.from_layer,
            routePoint.to_layer,
            srj.layerCount,
          ),
          start: routePoint,
          end: routePoint,
          radius: (routePoint.via_diameter ?? defaultViaDiameter) / 2,
        })
      } else if (routePoint.route_type === "through_obstacle") {
        primitives.push({
          fixedNetId,
          connectionName: trace.connection_name,
          zLayers: getLayersBetween(
            routePoint.from_layer,
            routePoint.to_layer,
            srj.layerCount,
          ),
          start: routePoint.start,
          end: routePoint.end,
          radius: routePoint.width / 2,
        })
      } else if (routePoint.route_type === "jumper") {
        const dimensions = JUMPER_DIMENSIONS[routePoint.footprint]
        const padRadius = Math.hypot(
          dimensions.padLength / 2,
          dimensions.padWidth / 2,
        )
        const z = mapLayerNameToZ(routePoint.layer, srj.layerCount)
        for (const padCenter of [routePoint.start, routePoint.end]) {
          primitives.push({
            fixedNetId,
            connectionName: trace.connection_name,
            zLayers: [z],
            start: padCenter,
            end: padCenter,
            radius: padRadius,
          })
        }
      }
    }

    for (let pointIndex = 0; pointIndex < trace.route.length - 1; pointIndex++) {
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
        fixedNetId,
        connectionName: trace.connection_name,
        zLayers: [mapLayerNameToZ(start.layer, srj.layerCount)],
        start,
        end,
        radius: Math.max(start.width, end.width) / 2,
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
    .filter((portPoint) => portPoint.availableZ.includes(z))
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
) => {
  const fixedNetIds = [
    ...new Set([
      ...(portPoint._preloadedFixedNetIds ?? []),
      primitive.fixedNetId,
    ]),
  ].sort()
  portPoint._preloadedFixedNetIds = fixedNetIds

  if (portPoint.connectionName === null) {
    portPoint.connectionName = primitive.connectionName
    portPoint.rootConnectionName = primitive.fixedNetId
  }
}

/**
 * Loads fixed copper onto the existing capacity-graph boundary ports.
 *
 * The capacity regions and their adjacency are intentionally untouched. A
 * physical trace crossing is quantized to the closest already-existing port
 * on that boundary and layer, then reserved for the trace's canonical net.
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
    for (const primitive of this.primitives) {
      for (const segment of this.sharedEdgeSegments) {
        if (
          minimumDistanceBetweenSegments(
            primitive.start,
            primitive.end,
            segment.start,
            segment.end,
          ) >
          primitive.radius + GEOMETRIC_TOLERANCE
        ) {
          continue
        }

        for (const z of primitive.zLayers) {
          if (!segment.availableZ.includes(z)) continue
          const portPoint = getClosestPortPoint(segment, primitive, z)
          if (portPoint) preloadPort(portPoint, primitive)
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
          count + (portPoint._preloadedFixedNetIds?.length ?? 0),
        0,
      ),
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
