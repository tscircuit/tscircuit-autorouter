import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import {
  getNodeBounds,
  getNodePolygon,
  getRayDistanceToPolygonBoundary,
  isPolygonRectangular,
} from "./capacityMeshNodeGeometry"

type Point = { x: number; y: number }

const EPSILON = 1e-9
const normalizeDirection = (point: Point, center: Point) => {
  const dx = point.x - center.x
  const dy = point.y - center.y
  const distance = Math.hypot(dx, dy)
  if (distance <= EPSILON) {
    return { dx: 0, dy: 0, distance: 0 }
  }
  return {
    dx: dx / distance,
    dy: dy / distance,
    distance,
  }
}

const createRectPolygon = (bounds: {
  minX: number
  maxX: number
  minY: number
  maxY: number
}) => [
  { x: bounds.minX, y: bounds.minY },
  { x: bounds.maxX, y: bounds.minY },
  { x: bounds.maxX, y: bounds.maxY },
  { x: bounds.minX, y: bounds.maxY },
]

export const createNodeRectification = (node: NodeWithPortPoints) => {
  const sourcePolygon = getNodePolygon(node as any)
  if (!node.polygon || isPolygonRectangular(node.polygon)) {
    return {
      rectifiedNode: node,
      toRectPoint: (point: Point) => point,
      fromRectPoint: (point: Point) => point,
      reverseRoute: (route: HighDensityIntraNodeRoute) => route,
    }
  }

  const bounds = getNodeBounds(node as any)
  const rectPolygon = createRectPolygon(bounds)
  const center = node.center

  const mapBetweenPolygons = (
    point: Point,
    fromPolygon: Point[],
    toPolygon: Point[],
  ): Point => {
    const direction = normalizeDirection(point, center)
    if (direction.distance <= EPSILON) {
      return { ...center }
    }

    const fromBoundaryDistance = getRayDistanceToPolygonBoundary(
      center,
      { x: direction.dx, y: direction.dy },
      fromPolygon,
    )
    const toBoundaryDistance = getRayDistanceToPolygonBoundary(
      center,
      { x: direction.dx, y: direction.dy },
      toPolygon,
    )

    if (fromBoundaryDistance <= EPSILON || toBoundaryDistance <= EPSILON) {
      return point
    }

    const normalizedDistance = Math.min(
      1,
      Math.max(0, direction.distance / fromBoundaryDistance),
    )

    return {
      x: center.x + direction.dx * toBoundaryDistance * normalizedDistance,
      y: center.y + direction.dy * toBoundaryDistance * normalizedDistance,
    }
  }

  const toRectPoint = (point: Point) =>
    mapBetweenPolygons(point, sourcePolygon, rectPolygon)
  const fromRectPoint = (point: Point) =>
    mapBetweenPolygons(point, rectPolygon, sourcePolygon)

  const rectifiedNode: NodeWithPortPoints = {
    ...node,
    polygon: rectPolygon,
    bounds,
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
    portPoints: node.portPoints.map((portPoint) => ({ ...portPoint })),
  }

  const rectifiedPortPointPairs = node.portPoints.map(
    (originalPortPoint, i) => ({
      originalPortPoint,
      rectifiedPortPoint: rectifiedNode.portPoints[i]!,
    }),
  )

  const snapToOriginalPortPoint = (
    point: HighDensityIntraNodeRoute["route"][number],
    route: HighDensityIntraNodeRoute,
  ) => {
    let bestMatch:
      | {
          x: number
          y: number
          z: number
        }
      | undefined
    let bestDistance = Infinity

    for (const {
      originalPortPoint,
      rectifiedPortPoint,
    } of rectifiedPortPointPairs) {
      if (
        "portPointId" in point &&
        point.portPointId &&
        originalPortPoint.portPointId === point.portPointId
      ) {
        return {
          x: originalPortPoint.x,
          y: originalPortPoint.y,
          z: originalPortPoint.z,
        }
      }

      if (
        rectifiedPortPoint.connectionName !== route.connectionName &&
        rectifiedPortPoint.rootConnectionName !== route.rootConnectionName
      ) {
        continue
      }

      if (rectifiedPortPoint.z !== point.z) {
        continue
      }

      const distance = Math.hypot(
        rectifiedPortPoint.x - point.x,
        rectifiedPortPoint.y - point.y,
      )
      if (distance < bestDistance) {
        bestDistance = distance
        bestMatch = {
          x: originalPortPoint.x,
          y: originalPortPoint.y,
          z: originalPortPoint.z,
        }
      }
    }

    return bestMatch
  }

  return {
    rectifiedNode,
    toRectPoint,
    fromRectPoint,
    reverseRoute: (
      route: HighDensityIntraNodeRoute,
    ): HighDensityIntraNodeRoute => ({
      ...route,
      route: route.route.map((point, index) => {
        const snappedPortPoint =
          index === 0 || index === route.route.length - 1
            ? snapToOriginalPortPoint(point, route)
            : null
        return snappedPortPoint
          ? {
              ...point,
              ...snappedPortPoint,
            }
          : {
              ...point,
              ...fromRectPoint(point),
            }
      }),
      vias: route.vias.map((via) => fromRectPoint(via)),
    }),
  }
}
