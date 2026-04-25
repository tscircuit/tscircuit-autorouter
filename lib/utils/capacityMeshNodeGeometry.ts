import {
  pointToBoxDistance,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type {
  CapacityMeshBounds,
  CapacityMeshNode,
  CapacityMeshPoint,
} from "lib/types"
import { isPointInOrOnPolygon } from "./polygonContainment"

const EPSILON = 1e-3

export const getBoundsFromPoints = (
  points: CapacityMeshPoint[],
): CapacityMeshBounds => {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  return { minX, maxX, minY, maxY }
}

export const getNodeBounds = (
  node: Pick<
    CapacityMeshNode,
    "bounds" | "polygon" | "center" | "width" | "height"
  >,
): CapacityMeshBounds => {
  if (node.bounds) {
    return node.bounds
  }
  if (node.polygon && node.polygon.length > 0) {
    return getBoundsFromPoints(node.polygon)
  }
  return {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }
}

export const getNodePolygon = (
  node: Pick<
    CapacityMeshNode,
    "polygon" | "bounds" | "center" | "width" | "height"
  >,
): CapacityMeshPoint[] => {
  if (node.polygon && node.polygon.length >= 3) {
    return node.polygon
  }
  const bounds = getNodeBounds(node)
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ]
}

export const isPointInNode = (
  point: CapacityMeshPoint,
  node: Pick<
    CapacityMeshNode,
    "polygon" | "bounds" | "center" | "width" | "height"
  >,
): boolean => {
  if (node.polygon && node.polygon.length >= 3) {
    return isPointInOrOnPolygon(point, node.polygon)
  }
  return pointToBoxDistance(point, node) === 0
}

const pointsEqual = (a: CapacityMeshPoint, b: CapacityMeshPoint) =>
  Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON

const cross = (
  origin: CapacityMeshPoint,
  a: CapacityMeshPoint,
  b: CapacityMeshPoint,
) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)

const areSegmentsCollinear = (
  a1: CapacityMeshPoint,
  a2: CapacityMeshPoint,
  b1: CapacityMeshPoint,
  b2: CapacityMeshPoint,
) => {
  const length = Math.max(EPSILON, Math.hypot(a2.x - a1.x, a2.y - a1.y))
  return (
    Math.abs(cross(a1, a2, b1)) / length <= EPSILON &&
    Math.abs(cross(a1, a2, b2)) / length <= EPSILON
  )
}

const getDominantAxis = (start: CapacityMeshPoint, end: CapacityMeshPoint) =>
  Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? "x" : "y"

const interpolatePoint = (
  start: CapacityMeshPoint,
  end: CapacityMeshPoint,
  t: number,
): CapacityMeshPoint => ({
  x: start.x + (end.x - start.x) * t,
  y: start.y + (end.y - start.y) * t,
})

const getEdgeOverlap = (
  a1: CapacityMeshPoint,
  a2: CapacityMeshPoint,
  b1: CapacityMeshPoint,
  b2: CapacityMeshPoint,
): { start: CapacityMeshPoint; end: CapacityMeshPoint } | null => {
  if (!areSegmentsCollinear(a1, a2, b1, b2)) return null

  const axis = getDominantAxis(a1, a2)
  const aStart = axis === "x" ? a1.x : a1.y
  const aEnd = axis === "x" ? a2.x : a2.y
  const bStart = axis === "x" ? b1.x : b1.y
  const bEnd = axis === "x" ? b2.x : b2.y

  const aMin = Math.min(aStart, aEnd)
  const aMax = Math.max(aStart, aEnd)
  const bMin = Math.min(bStart, bEnd)
  const bMax = Math.max(bStart, bEnd)

  const overlapStart = Math.max(aMin, bMin)
  const overlapEnd = Math.min(aMax, bMax)
  if (overlapEnd - overlapStart <= EPSILON) return null

  const aLength = aEnd - aStart
  if (Math.abs(aLength) <= EPSILON) return null

  const startT = (overlapStart - aStart) / aLength
  const endT = (overlapEnd - aStart) / aLength

  return {
    start: interpolatePoint(a1, a2, startT),
    end: interpolatePoint(a1, a2, endT),
  }
}

const isPointOnSegment = (
  point: CapacityMeshPoint,
  start: CapacityMeshPoint,
  end: CapacityMeshPoint,
) => pointToSegmentDistance(point, start, end) <= EPSILON

const getEdgeTouchPoint = (
  a1: CapacityMeshPoint,
  a2: CapacityMeshPoint,
  b1: CapacityMeshPoint,
  b2: CapacityMeshPoint,
): CapacityMeshPoint | null => {
  for (const candidate of [a1, a2]) {
    if (isPointOnSegment(candidate, b1, b2)) {
      return candidate
    }
  }

  for (const candidate of [b1, b2]) {
    if (isPointOnSegment(candidate, a1, a2)) {
      return candidate
    }
  }

  return null
}

export const getSharedNodeBoundarySegment = (
  nodeA: Pick<
    CapacityMeshNode,
    "polygon" | "bounds" | "center" | "width" | "height"
  >,
  nodeB: Pick<
    CapacityMeshNode,
    "polygon" | "bounds" | "center" | "width" | "height"
  >,
): { start: CapacityMeshPoint; end: CapacityMeshPoint } | null => {
  const polygonA = getNodePolygon(nodeA)
  const polygonB = getNodePolygon(nodeB)

  let bestSegment: { start: CapacityMeshPoint; end: CapacityMeshPoint } | null =
    null
  let bestLength = 0
  let touchPoint: CapacityMeshPoint | null = null

  for (let i = 0; i < polygonA.length; i++) {
    const a1 = polygonA[i]
    const a2 = polygonA[(i + 1) % polygonA.length]
    for (let j = 0; j < polygonB.length; j++) {
      const b1 = polygonB[j]
      const b2 = polygonB[(j + 1) % polygonB.length]
      const overlap = getEdgeOverlap(a1, a2, b1, b2)
      if (!overlap) {
        touchPoint ||= getEdgeTouchPoint(a1, a2, b1, b2)
        continue
      }

      const length = Math.hypot(
        overlap.end.x - overlap.start.x,
        overlap.end.y - overlap.start.y,
      )
      if (length > bestLength) {
        bestLength = length
        bestSegment = overlap
      }
    }
  }

  if (bestSegment) {
    return bestSegment
  }

  if (touchPoint) {
    return {
      start: touchPoint,
      end: touchPoint,
    }
  }

  return null
}

export const getPolygonCentroid = (polygon: CapacityMeshPoint[]) => {
  const bounds = getBoundsFromPoints(polygon)
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }
}

export const getRayDistanceToPolygonBoundary = (
  center: CapacityMeshPoint,
  direction: CapacityMeshPoint,
  polygon: CapacityMeshPoint[],
): number => {
  let bestDistance = 0

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const edgeDx = b.x - a.x
    const edgeDy = b.y - a.y
    const det = direction.x * edgeDy - direction.y * edgeDx
    if (Math.abs(det) <= EPSILON) continue

    const relX = a.x - center.x
    const relY = a.y - center.y
    const t = (relX * edgeDy - relY * edgeDx) / det
    const u = (relX * direction.y - relY * direction.x) / det

    if (t < -EPSILON || u < -EPSILON || u > 1 + EPSILON) continue
    if (t > bestDistance) bestDistance = t
  }

  return bestDistance
}

export const createNormalizedPolygonKey = (polygon: CapacityMeshPoint[]) => {
  const ordered = [...polygon]
  let startIndex = 0
  for (let i = 1; i < ordered.length; i++) {
    const current = ordered[i]
    const best = ordered[startIndex]
    if (
      current.x < best.x - EPSILON ||
      (Math.abs(current.x - best.x) <= EPSILON && current.y < best.y - EPSILON)
    ) {
      startIndex = i
    }
  }

  const rotated = ordered.slice(startIndex).concat(ordered.slice(0, startIndex))

  const areaTwice = rotated.reduce((sum, point, index) => {
    const next = rotated[(index + 1) % rotated.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0)

  const normalized =
    areaTwice < 0 ? [rotated[0], ...rotated.slice(1).reverse()] : rotated

  return normalized
    .map((point) => `${point.x.toFixed(6)},${point.y.toFixed(6)}`)
    .join("|")
}

export const getDistanceFromPointToNodeBoundary = (
  point: CapacityMeshPoint,
  node: Pick<
    CapacityMeshNode,
    "polygon" | "bounds" | "center" | "width" | "height"
  >,
): number => {
  const polygon = getNodePolygon(node)
  let minDistance = Infinity
  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i]
    const end = polygon[(i + 1) % polygon.length]
    minDistance = Math.min(
      minDistance,
      pointToSegmentDistance(point, start, end),
    )
  }
  return minDistance
}

export const isPolygonRectangular = (
  polygon: CapacityMeshPoint[] | undefined,
): boolean => {
  if (!polygon || polygon.length !== 4) return false
  const bounds = getBoundsFromPoints(polygon)
  const rectPoints = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ]
  return polygon.every((point) =>
    rectPoints.some((rectPoint) => pointsEqual(point, rectPoint)),
  )
}
