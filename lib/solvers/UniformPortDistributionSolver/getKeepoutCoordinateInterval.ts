import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type {
  BoundaryPortKeepout,
  CoordinateInterval,
  SharedEdge,
} from "./types"

const SEARCH_ITERATIONS = 56
const DISTANCE_TOLERANCE = 1e-9

const getEdgeBounds = (sharedEdge: SharedEdge): CoordinateInterval =>
  sharedEdge.orientation === "horizontal"
    ? {
        min: Math.min(sharedEdge.x1, sharedEdge.x2),
        max: Math.max(sharedEdge.x1, sharedEdge.x2),
      }
    : {
        min: Math.min(sharedEdge.y1, sharedEdge.y2),
        max: Math.max(sharedEdge.y1, sharedEdge.y2),
      }

const getPointOnEdge = (sharedEdge: SharedEdge, coordinate: number) =>
  sharedEdge.orientation === "horizontal"
    ? { x: coordinate, y: sharedEdge.y1 }
    : { x: sharedEdge.x1, y: coordinate }

const getDistanceToRect = (
  point: { x: number; y: number },
  keepout: Extract<BoundaryPortKeepout, { shape: "rect" }>,
) => {
  const dx = Math.max(
    Math.abs(point.x - keepout.center.x) - keepout.width / 2,
    0,
  )
  const dy = Math.max(
    Math.abs(point.y - keepout.center.y) - keepout.height / 2,
    0,
  )
  return Math.hypot(dx, dy)
}

const getDistanceToKeepout = ({
  sharedEdge,
  coordinate,
  keepout,
}: {
  sharedEdge: SharedEdge
  coordinate: number
  keepout: BoundaryPortKeepout
}) => {
  const point = getPointOnEdge(sharedEdge, coordinate)
  return keepout.shape === "capsule"
    ? pointToSegmentDistance(point, keepout.start, keepout.end) -
        keepout.copperRadius
    : getDistanceToRect(point, keepout)
}

const getExpandedKeepoutBounds = ({
  keepout,
  clearanceRadius,
}: {
  keepout: BoundaryPortKeepout
  clearanceRadius: number
}) => {
  if (keepout.shape === "capsule") {
    const radius = keepout.copperRadius + clearanceRadius
    return {
      minX: Math.min(keepout.start.x, keepout.end.x) - radius,
      maxX: Math.max(keepout.start.x, keepout.end.x) + radius,
      minY: Math.min(keepout.start.y, keepout.end.y) - radius,
      maxY: Math.max(keepout.start.y, keepout.end.y) + radius,
    }
  }
  return {
    minX: keepout.center.x - keepout.width / 2 - clearanceRadius,
    maxX: keepout.center.x + keepout.width / 2 + clearanceRadius,
    minY: keepout.center.y - keepout.height / 2 - clearanceRadius,
    maxY: keepout.center.y + keepout.height / 2 + clearanceRadius,
  }
}

const expandedKeepoutTouchesEdge = ({
  sharedEdge,
  keepout,
  clearanceRadius,
}: {
  sharedEdge: SharedEdge
  keepout: BoundaryPortKeepout
  clearanceRadius: number
}) => {
  const bounds = getExpandedKeepoutBounds({ keepout, clearanceRadius })
  const edgeMinX = Math.min(sharedEdge.x1, sharedEdge.x2)
  const edgeMaxX = Math.max(sharedEdge.x1, sharedEdge.x2)
  const edgeMinY = Math.min(sharedEdge.y1, sharedEdge.y2)
  const edgeMaxY = Math.max(sharedEdge.y1, sharedEdge.y2)
  return (
    bounds.minX <= edgeMaxX &&
    bounds.maxX >= edgeMinX &&
    bounds.minY <= edgeMaxY &&
    bounds.maxY >= edgeMinY
  )
}

const findMinimumDistanceCoordinate = ({
  sharedEdge,
  keepout,
  edgeBounds,
}: {
  sharedEdge: SharedEdge
  keepout: BoundaryPortKeepout
  edgeBounds: CoordinateInterval
}) => {
  let left = edgeBounds.min
  let right = edgeBounds.max
  for (let iteration = 0; iteration < SEARCH_ITERATIONS; iteration++) {
    const first = left + (right - left) / 3
    const second = right - (right - left) / 3
    if (
      getDistanceToKeepout({ sharedEdge, coordinate: first, keepout }) <=
      getDistanceToKeepout({ sharedEdge, coordinate: second, keepout })
    ) {
      right = second
    } else {
      left = first
    }
  }
  return (left + right) / 2
}

const findBoundaryCoordinate = ({
  sharedEdge,
  keepout,
  clearanceRadius,
  outsideCoordinate,
  insideCoordinate,
}: {
  sharedEdge: SharedEdge
  keepout: BoundaryPortKeepout
  clearanceRadius: number
  outsideCoordinate: number
  insideCoordinate: number
}) => {
  let outside = outsideCoordinate
  let inside = insideCoordinate
  for (let iteration = 0; iteration < SEARCH_ITERATIONS; iteration++) {
    const midpoint = (outside + inside) / 2
    if (
      getDistanceToKeepout({
        sharedEdge,
        coordinate: midpoint,
        keepout,
      }) <= clearanceRadius
    ) {
      inside = midpoint
    } else {
      outside = midpoint
    }
  }
  return inside
}

/**
 * Intersects an axis-aligned shared edge with clearance-expanded copper.
 * Supported copper shapes are convex, so their forbidden coordinates form
 * at most one interval on the edge.
 */
export const getKeepoutCoordinateInterval = ({
  sharedEdge,
  keepout,
  traceRadius,
  clearance,
}: {
  sharedEdge: SharedEdge
  keepout: BoundaryPortKeepout
  traceRadius: number
  clearance: number
}): CoordinateInterval | undefined => {
  const clearanceRadius = traceRadius + clearance
  if (!expandedKeepoutTouchesEdge({ sharedEdge, keepout, clearanceRadius })) {
    return undefined
  }

  const edgeBounds = getEdgeBounds(sharedEdge)
  const minimumCoordinate = findMinimumDistanceCoordinate({
    sharedEdge,
    keepout,
    edgeBounds,
  })
  if (
    getDistanceToKeepout({
      sharedEdge,
      coordinate: minimumCoordinate,
      keepout,
    }) >
    clearanceRadius + DISTANCE_TOLERANCE
  ) {
    return undefined
  }

  const minimumEdgeDistance = getDistanceToKeepout({
    sharedEdge,
    coordinate: edgeBounds.min,
    keepout,
  })
  const maximumEdgeDistance = getDistanceToKeepout({
    sharedEdge,
    coordinate: edgeBounds.max,
    keepout,
  })

  return {
    min:
      minimumEdgeDistance <= clearanceRadius
        ? edgeBounds.min
        : findBoundaryCoordinate({
            sharedEdge,
            keepout,
            clearanceRadius,
            outsideCoordinate: edgeBounds.min,
            insideCoordinate: minimumCoordinate,
          }),
    max:
      maximumEdgeDistance <= clearanceRadius
        ? edgeBounds.max
        : findBoundaryCoordinate({
            sharedEdge,
            keepout,
            clearanceRadius,
            outsideCoordinate: edgeBounds.max,
            insideCoordinate: minimumCoordinate,
          }),
  }
}
