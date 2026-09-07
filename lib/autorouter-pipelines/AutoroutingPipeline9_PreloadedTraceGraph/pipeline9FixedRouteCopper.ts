import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { generateApproximatingRects } from "lib/utils/addApproximatingRectsToSrj"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

export type Pipeline9RouteWireSegment = {
  start: HighDensityRoute["route"][number]
  end: HighDensityRoute["route"][number]
  z: number
  width: number
}

export type Pipeline9RouteViaSpan = {
  center: { x: number; y: number }
  minZ: number
  maxZ: number
  diameter: number
}

export type Pipeline9RouteCopperGeometry = {
  wireSegments: Pipeline9RouteWireSegment[]
  viaSpans: Pipeline9RouteViaSpan[]
}

export type Pipeline9Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type Pipeline9AxisAlignedRect = {
  center: { x: number; y: number }
  width: number
  height: number
}

const FIXED_WIRE_MAX_APPROXIMATION_LENGTH = 0.75
const routeCopperGeometryCache = new WeakMap<
  HighDensityRoute,
  Pipeline9RouteCopperGeometry
>()
const routeCopperBoundsCache = new WeakMap<HighDensityRoute, Pipeline9Bounds>()

export const getPipeline9RouteCopperGeometry = (
  route: HighDensityRoute,
): Pipeline9RouteCopperGeometry => {
  const cachedGeometry = routeCopperGeometryCache.get(route)
  if (cachedGeometry) return cachedGeometry
  const wireSegments: Pipeline9RouteWireSegment[] = []
  const viaSpans: Pipeline9RouteViaSpan[] = []
  for (
    let routePointIndex = 1;
    routePointIndex < route.route.length;
    routePointIndex++
  ) {
    const start = route.route[routePointIndex - 1]!
    const end = route.route[routePointIndex]!
    const xyDistance = Math.hypot(end.x - start.x, end.y - start.y)
    const segmentWidth = Math.max(
      start.traceThickness ?? route.traceThickness,
      end.traceThickness ?? route.traceThickness,
    )
    if (start.z !== end.z && start.toNextSegmentType === "through_obstacle") {
      const minZ = Math.min(start.z, end.z)
      const maxZ = Math.max(start.z, end.z)
      if (xyDistance <= 1e-9) {
        const hasExplicitVia = route.vias.some(
          (via) => Math.hypot(via.x - end.x, via.y - end.y) <= 1e-9,
        )
        viaSpans.push({
          center: { x: end.x, y: end.y },
          minZ,
          maxZ,
          diameter: hasExplicitVia ? route.viaDiameter : segmentWidth,
        })
        continue
      }
      for (let z = minZ; z <= maxZ; z++) {
        wireSegments.push({
          start: { ...start, z },
          end: { ...end, z },
          z,
          width: segmentWidth,
        })
      }
      continue
    }
    if (xyDistance > 1e-9) {
      wireSegments.push({
        start,
        end: start.z === end.z ? end : { ...end, z: start.z },
        z: start.z,
        width: segmentWidth,
      })
    }
    if (start.z === end.z) continue
    viaSpans.push({
      center: { x: end.x, y: end.y },
      minZ: Math.min(start.z, end.z),
      maxZ: Math.max(start.z, end.z),
      diameter: route.viaDiameter,
    })
  }
  const geometry = { wireSegments, viaSpans }
  routeCopperGeometryCache.set(route, geometry)
  return geometry
}

export const getPipeline9RouteCopperBounds = (
  route: HighDensityRoute,
): Pipeline9Bounds | undefined => {
  const cachedBounds = routeCopperBoundsCache.get(route)
  if (cachedBounds) return cachedBounds
  const geometry = getPipeline9RouteCopperGeometry(route)
  let bounds: Pipeline9Bounds | undefined
  for (const wire of geometry.wireSegments) {
    const radius = wire.width / 2
    const wireBounds = {
      minX: Math.min(wire.start.x, wire.end.x) - radius,
      maxX: Math.max(wire.start.x, wire.end.x) + radius,
      minY: Math.min(wire.start.y, wire.end.y) - radius,
      maxY: Math.max(wire.start.y, wire.end.y) + radius,
    }
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, wireBounds.minX),
          maxX: Math.max(bounds.maxX, wireBounds.maxX),
          minY: Math.min(bounds.minY, wireBounds.minY),
          maxY: Math.max(bounds.maxY, wireBounds.maxY),
        }
      : wireBounds
  }
  for (const via of geometry.viaSpans) {
    const radius = via.diameter / 2
    const viaBounds = {
      minX: via.center.x - radius,
      maxX: via.center.x + radius,
      minY: via.center.y - radius,
      maxY: via.center.y + radius,
    }
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, viaBounds.minX),
          maxX: Math.max(bounds.maxX, viaBounds.maxX),
          minY: Math.min(bounds.minY, viaBounds.minY),
          maxY: Math.max(bounds.maxY, viaBounds.maxY),
        }
      : viaBounds
  }
  if (bounds) routeCopperBoundsCache.set(route, bounds)
  return bounds
}

export const getPipeline9AxisAlignedWireApproximations = (
  segment: Pipeline9RouteWireSegment,
  maxApproximationLength: number,
  minimumRectCount: number,
): Pipeline9AxisAlignedRect[] => {
  const dx = segment.end.x - segment.start.x
  const dy = segment.end.y - segment.start.y
  const segmentLength = Math.hypot(dx, dy)
  const center = {
    x: (segment.start.x + segment.end.x) / 2,
    y: (segment.start.y + segment.end.y) / 2,
  }
  if (Math.abs(dx) <= 1e-9 || Math.abs(dy) <= 1e-9) {
    return [
      {
        center,
        width: Math.abs(dx) > Math.abs(dy) ? segmentLength : segment.width,
        height: Math.abs(dx) > Math.abs(dy) ? segment.width : segmentLength,
      },
    ]
  }
  return generateApproximatingRects(
    {
      center,
      width: segmentLength,
      height: segment.width,
      rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
    },
    Math.max(
      minimumRectCount,
      Math.ceil(segmentLength / maxApproximationLength),
    ),
  )
}

export const getPipeline9FixedRouteObstacles = ({
  fixedObstacleRoutes,
  layerCount,
}: {
  fixedObstacleRoutes: HighDensityRoute[]
  layerCount: number
}): Obstacle[] => {
  return fixedObstacleRoutes.flatMap((route, routeIndex) => {
    const connectedTo = [route.connectionName, route.rootConnectionName].filter(
      (connectedId): connectedId is string => typeof connectedId === "string",
    )
    const geometry = getPipeline9RouteCopperGeometry(route)
    return [
      ...geometry.wireSegments.flatMap((segment, segmentIndex): Obstacle[] => {
        const approximatingRects = getPipeline9AxisAlignedWireApproximations(
          segment,
          FIXED_WIRE_MAX_APPROXIMATION_LENGTH,
          2,
        )
        return approximatingRects.map((rect, approximationIndex) => ({
          obstacleId: `pipeline9_fixed_obstacle_${routeIndex}_wire_${segmentIndex}_${approximationIndex}`,
          type: "rect",
          layers: [mapZToLayerName(segment.z, layerCount)],
          center: rect.center,
          width: rect.width,
          height: rect.height,
          connectedTo,
        }))
      }),
      ...geometry.viaSpans.map(
        (via, viaIndex): Obstacle => ({
          obstacleId: `pipeline9_fixed_obstacle_${routeIndex}_via_${viaIndex}`,
          type: "rect",
          layers: Array.from(
            { length: via.maxZ - via.minZ + 1 },
            (_, layerOffset) =>
              mapZToLayerName(via.minZ + layerOffset, layerCount),
          ),
          center: via.center,
          width: via.diameter,
          height: via.diameter,
          connectedTo,
        }),
      ),
    ]
  })
}

export const arePipeline9RoutesOnSameNet = (
  left: HighDensityRoute,
  right: HighDensityRoute,
  connMap: ConnectivityMap,
): boolean => {
  const leftIds = [left.connectionName, left.rootConnectionName].filter(
    (id): id is string => typeof id === "string",
  )
  const rightIds = [right.connectionName, right.rootConnectionName].filter(
    (id): id is string => typeof id === "string",
  )
  return leftIds.some((leftId) =>
    rightIds.some(
      (rightId) =>
        leftId === rightId || connMap.areIdsConnected(leftId, rightId),
    ),
  )
}

export const doPipeline9BoundsOverlap = (
  left: Pipeline9Bounds,
  right: Pipeline9Bounds,
): boolean => {
  return (
    left.minX <= right.maxX &&
    left.maxX >= right.minX &&
    left.minY <= right.maxY &&
    left.maxY >= right.minY
  )
}

const wireSegmentOverlapsBounds = (
  segment: Pipeline9RouteWireSegment,
  bounds: Pipeline9Bounds,
): boolean => {
  const segmentBounds = {
    minX: Math.min(segment.start.x, segment.end.x) - segment.width / 2,
    maxX: Math.max(segment.start.x, segment.end.x) + segment.width / 2,
    minY: Math.min(segment.start.y, segment.end.y) - segment.width / 2,
    maxY: Math.max(segment.start.y, segment.end.y) + segment.width / 2,
  }
  return doPipeline9BoundsOverlap(segmentBounds, bounds)
}

const viaSpanOverlapsBounds = (
  via: Pipeline9RouteViaSpan,
  bounds: Pipeline9Bounds,
): boolean => {
  const viaBounds = {
    minX: via.center.x - via.diameter / 2,
    maxX: via.center.x + via.diameter / 2,
    minY: via.center.y - via.diameter / 2,
    maxY: via.center.y + via.diameter / 2,
  }
  return doPipeline9BoundsOverlap(viaBounds, bounds)
}

export const doPipeline9RoutesHaveCopperConflict = ({
  left,
  right,
  clearance,
  leftBounds,
}: {
  left: HighDensityRoute
  right: HighDensityRoute
  clearance: number
  leftBounds?: Pipeline9Bounds
}): boolean => {
  const leftCopperBounds = getPipeline9RouteCopperBounds(left)
  const rightCopperBounds = getPipeline9RouteCopperBounds(right)
  if (
    !leftCopperBounds ||
    !rightCopperBounds ||
    !doPipeline9BoundsOverlap(
      {
        minX: leftCopperBounds.minX - clearance,
        maxX: leftCopperBounds.maxX + clearance,
        minY: leftCopperBounds.minY - clearance,
        maxY: leftCopperBounds.maxY + clearance,
      },
      rightCopperBounds,
    )
  ) {
    return false
  }
  const leftGeometry = getPipeline9RouteCopperGeometry(left)
  const rightGeometry = getPipeline9RouteCopperGeometry(right)
  const leftWires = leftBounds
    ? leftGeometry.wireSegments.filter((segment) =>
        wireSegmentOverlapsBounds(segment, leftBounds),
      )
    : leftGeometry.wireSegments
  const leftVias = leftBounds
    ? leftGeometry.viaSpans.filter((via) =>
        viaSpanOverlapsBounds(via, leftBounds),
      )
    : leftGeometry.viaSpans
  for (const leftWire of leftWires) {
    for (const rightWire of rightGeometry.wireSegments) {
      if (leftWire.z !== rightWire.z) continue
      const requiredClearance =
        leftWire.width / 2 + rightWire.width / 2 + clearance
      if (
        minimumDistanceBetweenSegments(
          leftWire.start,
          leftWire.end,
          rightWire.start,
          rightWire.end,
        ) < requiredClearance
      ) {
        return true
      }
    }
    for (const rightVia of rightGeometry.viaSpans) {
      if (leftWire.z < rightVia.minZ || leftWire.z > rightVia.maxZ) continue
      const requiredClearance =
        leftWire.width / 2 + rightVia.diameter / 2 + clearance
      if (
        minimumDistanceBetweenSegments(
          leftWire.start,
          leftWire.end,
          rightVia.center,
          rightVia.center,
        ) < requiredClearance
      ) {
        return true
      }
    }
  }
  for (const leftVia of leftVias) {
    for (const rightWire of rightGeometry.wireSegments) {
      if (rightWire.z < leftVia.minZ || rightWire.z > leftVia.maxZ) continue
      const requiredClearance =
        leftVia.diameter / 2 + rightWire.width / 2 + clearance
      if (
        minimumDistanceBetweenSegments(
          leftVia.center,
          leftVia.center,
          rightWire.start,
          rightWire.end,
        ) < requiredClearance
      ) {
        return true
      }
    }
    for (const rightVia of rightGeometry.viaSpans) {
      if (leftVia.minZ > rightVia.maxZ || rightVia.minZ > leftVia.maxZ) continue
      const requiredClearance =
        leftVia.diameter / 2 + rightVia.diameter / 2 + clearance
      if (
        Math.hypot(
          leftVia.center.x - rightVia.center.x,
          leftVia.center.y - rightVia.center.y,
        ) < requiredClearance
      ) {
        return true
      }
    }
  }
  return false
}
