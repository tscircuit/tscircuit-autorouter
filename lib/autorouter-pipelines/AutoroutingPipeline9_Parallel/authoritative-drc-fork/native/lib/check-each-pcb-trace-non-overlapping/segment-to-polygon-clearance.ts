// Pinned from @tscircuit/checks 0.0.233 bundled source; see the authoritative-drc-fork LICENSE and PROVENANCE.md.
import {
  distSq,
  getSegmentIntersection,
  isPointInsidePolygon,
  type Point,
  pointToSegmentClosestPoint,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import type { PcbHole, PcbPlatedHole, PcbSmtPad } from "circuit-json"
import type { PcbTraceSegment } from "./getCollidableBounds"

type PolygonalPad = PcbSmtPad | PcbPlatedHole
type PillPad =
  | Extract<PcbSmtPad, { shape: "pill" | "rotated_pill" }>
  | Extract<PcbPlatedHole, { shape: "oval" | "pill" }>
type PillHole = Extract<PcbHole, { hole_shape: "pill" | "rotated_pill" }>

const rotatePoint = (point: Point, angleDegrees: number): Point => {
  const angle = (angleDegrees * Math.PI) / 180
  return {
    x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
  }
}

export const getRotatedRectPoints = ({
  x,
  y,
  width,
  height,
  ccwRotation,
}: {
  x: number
  y: number
  width: number
  height: number
  ccwRotation: number
}): Point[] => {
  const halfWidth = width / 2
  const halfHeight = height / 2

  return [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map((point) => {
    const rotated = rotatePoint(point, ccwRotation)
    return { x: x + rotated.x, y: y + rotated.y }
  })
}

export const getPillCenterLineForPad = (pad: PillPad | PillHole) => {
  let width: number
  let height: number
  let radius: number
  let ccwRotation = 0
  if (pad.type === "pcb_hole") {
    width = pad.hole_width
    height = pad.hole_height
    radius = Math.min(width, height) / 2
    if (pad.hole_shape === "rotated_pill") ccwRotation = pad.ccw_rotation
  } else if (pad.type === "pcb_plated_hole") {
    width = pad.outer_width
    height = pad.outer_height
    radius = Math.min(width, height) / 2
    ccwRotation = pad.ccw_rotation
  } else {
    width = pad.width
    height = pad.height
    radius = pad.radius
    if (pad.shape === "rotated_pill") ccwRotation = pad.ccw_rotation
  }
  const halfLineLength = Math.max(Math.max(width, height) / 2 - radius, 0)
  const axis =
    width >= height ? { x: halfLineLength, y: 0 } : { x: 0, y: halfLineLength }
  const rotatedAxis = rotatePoint(axis, ccwRotation)

  return {
    start: { x: pad.x - rotatedAxis.x, y: pad.y - rotatedAxis.y },
    end: { x: pad.x + rotatedAxis.x, y: pad.y + rotatedAxis.y },
    radius,
  }
}

export const getPolygonPointsForPad = (pad: PolygonalPad): Point[] => {
  if (pad.type === "pcb_smtpad") {
    if (pad.shape === "polygon") return pad.points

    if (pad.shape === "rotated_rect") {
      return getRotatedRectPoints({
        x: pad.x,
        y: pad.y,
        width: pad.width,
        height: pad.height,
        ccwRotation: pad.ccw_rotation,
      })
    }
  }

  if (
    pad.type === "pcb_plated_hole" &&
    "rect_pad_width" in pad &&
    "rect_pad_height" in pad
  ) {
    return getRotatedRectPoints({
      x: pad.x,
      y: pad.y,
      width: pad.rect_pad_width,
      height: pad.rect_pad_height,
      ccwRotation:
        "rect_ccw_rotation" in pad && typeof pad.rect_ccw_rotation === "number"
          ? pad.rect_ccw_rotation
          : 0,
    })
  }

  throw new Error(
    `Expected polygonal pad geometry, got ${pad.type} with shape "${pad.shape}"`,
  )
}

const getPolygonEdges = (points: Point[]) =>
  points.map(
    (point, index) => [point, points[(index + 1) % points.length]!] as const,
  )

const getClosestPointsBetweenSegments = (
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
) => {
  const intersection = getSegmentIntersection(a1, a2, b1, b2)
  if (intersection) {
    return {
      distance: 0,
      pointOnA: intersection,
      pointOnB: intersection,
      center: intersection,
    }
  }

  const candidates = [
    { pointOnA: a1, pointOnB: pointToSegmentClosestPoint(a1, b1, b2) },
    { pointOnA: a2, pointOnB: pointToSegmentClosestPoint(a2, b1, b2) },
    { pointOnA: pointToSegmentClosestPoint(b1, a1, a2), pointOnB: b1 },
    { pointOnA: pointToSegmentClosestPoint(b2, a1, a2), pointOnB: b2 },
  ]

  let best = candidates[0]!
  let bestDistanceSquared = distSq(best.pointOnA, best.pointOnB)
  for (const candidate of candidates.slice(1)) {
    const candidateDistanceSquared = distSq(
      candidate.pointOnA,
      candidate.pointOnB,
    )
    if (candidateDistanceSquared < bestDistanceSquared) {
      best = candidate
      bestDistanceSquared = candidateDistanceSquared
    }
  }

  return {
    distance: segmentToSegmentMinDistance(a1, a2, b1, b2),
    pointOnA: best.pointOnA,
    pointOnB: best.pointOnB,
    center: {
      x: (best.pointOnA.x + best.pointOnB.x) / 2,
      y: (best.pointOnA.y + best.pointOnB.y) / 2,
    },
  }
}

export const getSegmentToPolygonClearanceFromPoints = (
  start: Point,
  end: Point,
  polygon: Point[],
) => {
  if (polygon.length < 3) {
    return {
      distance: Number.POSITIVE_INFINITY,
      center: start,
      tracePoint: start,
      obstaclePoint: start,
    }
  }

  const intersections = getPolygonEdges(polygon)
    .map(([edgeStart, edgeEnd]) =>
      getSegmentIntersection(start, end, edgeStart, edgeEnd),
    )
    .filter((point): point is Point => point !== null)

  if (intersections.length > 0) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    intersections.sort((a, b) => {
      const ta = ((a.x - start.x) * dx + (a.y - start.y) * dy) / lengthSquared
      const tb = ((b.x - start.x) * dx + (b.y - start.y) * dy) / lengthSquared
      return ta - tb
    })

    return {
      distance: 0,
      center: intersections[0]!,
      tracePoint: intersections[0]!,
      obstaclePoint: intersections[0]!,
    }
  }

  if (
    isPointInsidePolygon(start, polygon) ||
    isPointInsidePolygon(end, polygon)
  ) {
    const center = {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    }
    return {
      distance: 0,
      center,
      tracePoint: center,
      obstaclePoint: center,
    }
  }

  let best = getClosestPointsBetweenSegments(
    start,
    end,
    polygon[0]!,
    polygon[1]!,
  )

  for (const [edgeStart, edgeEnd] of getPolygonEdges(polygon).slice(1)) {
    const candidate = getClosestPointsBetweenSegments(
      start,
      end,
      edgeStart,
      edgeEnd,
    )
    if (candidate.distance < best.distance) best = candidate
  }

  return {
    distance: best.distance,
    center: best.center,
    tracePoint: best.pointOnA,
    obstaclePoint: best.pointOnB,
  }
}

export const getSegmentToPolygonClearance = (
  segment: PcbTraceSegment,
  polygon: Point[],
) =>
  getSegmentToPolygonClearanceFromPoints(
    { x: segment.x1, y: segment.y1 },
    { x: segment.x2, y: segment.y2 },
    polygon,
  )

export const getSegmentToPillClearance = (
  segment: Pick<PcbTraceSegment, "x1" | "y1" | "x2" | "y2">,
  pad: PillPad | PillHole,
) => {
  const pill = getPillCenterLineForPad(pad)
  const closest = getClosestPointsBetweenSegments(
    { x: segment.x1, y: segment.y1 },
    { x: segment.x2, y: segment.y2 },
    pill.start,
    pill.end,
  )

  return {
    distance: closest.distance,
    center: closest.center,
    radius: pill.radius,
    tracePoint: closest.pointOnA,
    obstaclePoint: closest.pointOnB,
  }
}
