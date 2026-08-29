import type { HybridBoardBounds, HybridBoardPoint } from "./types"
import type {
  HybridCopperPoint,
  HybridCopperPrimitive,
  HybridCopperSegment,
  HybridCopperVia,
} from "./transactional-copper-types"

const GEOMETRY_EPSILON = 1e-9

export function getPrimitiveBounds(
  primitive: HybridCopperPrimitive,
): HybridBoardBounds {
  if (primitive.kind === "via") {
    const radius = primitive.padDiameterMm / 2
    return {
      minX: primitive.x - radius,
      maxX: primitive.x + radius,
      minY: primitive.y - radius,
      maxY: primitive.y + radius,
    }
  }
  const radius = primitive.widthMm / 2
  return {
    minX: Math.min(primitive.start.x, primitive.end.x) - radius,
    maxX: Math.max(primitive.start.x, primitive.end.x) + radius,
    minY: Math.min(primitive.start.y, primitive.end.y) - radius,
    maxY: Math.max(primitive.start.y, primitive.end.y) + radius,
  }
}

export function expandBounds({
  bounds,
  distanceMm,
}: {
  bounds: HybridBoardBounds
  distanceMm: number
}): HybridBoardBounds {
  return {
    minX: bounds.minX - distanceMm,
    maxX: bounds.maxX + distanceMm,
    minY: bounds.minY - distanceMm,
    maxY: bounds.maxY + distanceMm,
  }
}

export function boundsIntersect({
  first,
  second,
}: {
  first: HybridBoardBounds
  second: HybridBoardBounds
}): boolean {
  return !(
    first.maxX < second.minX ||
    first.minX > second.maxX ||
    first.maxY < second.minY ||
    first.minY > second.maxY
  )
}

export function primitiveEdgeDistance({
  first,
  second,
}: {
  first: HybridCopperPrimitive
  second: HybridCopperPrimitive
}): number {
  if (first.kind === "segment" && second.kind === "segment") {
    return (
      segmentToSegmentDistance({
        firstStart: first.start,
        firstEnd: first.end,
        secondStart: second.start,
        secondEnd: second.end,
      }) -
      first.widthMm / 2 -
      second.widthMm / 2
    )
  }
  if (first.kind === "via" && second.kind === "via") {
    return (
      pointDistance({ first, second }) -
      first.padDiameterMm / 2 -
      second.padDiameterMm / 2
    )
  }
  if (first.kind === "segment" && second.kind === "via") {
    return (
      pointToSegmentDistance({
        point: second,
        start: first.start,
        end: first.end,
      }) -
      second.padDiameterMm / 2 -
      first.widthMm / 2
    )
  }
  if (first.kind === "via" && second.kind === "segment") {
    return (
      pointToSegmentDistance({
        point: first,
        start: second.start,
        end: second.end,
      }) -
      first.padDiameterMm / 2 -
      second.widthMm / 2
    )
  }
  throw new Error("unreachable hybrid copper primitive combination")
}

export function pointToPrimitiveEdgeDistance({
  point,
  layer,
  primitive,
  viaLayers,
}: {
  point: HybridCopperPoint
  layer: string
  primitive: HybridCopperPrimitive
  viaLayers: readonly string[]
}): number {
  if (primitive.kind === "segment") {
    if (primitive.layer !== layer) return Number.POSITIVE_INFINITY
    return (
      pointToSegmentDistance({
        point,
        start: primitive.start,
        end: primitive.end,
      }) -
      primitive.widthMm / 2
    )
  }
  if (!viaLayers.includes(layer)) return Number.POSITIVE_INFINITY
  return pointDistance({ first: point, second: primitive }) - primitive.padDiameterMm / 2
}

export function segmentToRotatedRectEdgeDistance({
  segment,
  rect,
}: {
  segment: HybridCopperSegment
  rect: {
    readonly center: HybridCopperPoint
    readonly width: number
    readonly height: number
    readonly ccwRotationDegrees?: number
  }
}): number {
  const rotation = rect.ccwRotationDegrees ?? 0
  const localStart = rotatePointToLocal({
    point: segment.start,
    center: rect.center,
    rotationDegrees: rotation,
  })
  const localEnd = rotatePointToLocal({
    point: segment.end,
    center: rect.center,
    rotationDegrees: rotation,
  })
  return (
    segmentToAxisAlignedRectDistance({
      start: localStart,
      end: localEnd,
      halfWidth: rect.width / 2,
      halfHeight: rect.height / 2,
    }) -
    segment.widthMm / 2
  )
}

export function viaToRotatedRectEdgeDistance({
  via,
  rect,
}: {
  via: HybridCopperVia
  rect: {
    readonly center: HybridCopperPoint
    readonly width: number
    readonly height: number
    readonly ccwRotationDegrees?: number
  }
}): number {
  const localPoint = rotatePointToLocal({
    point: via,
    center: rect.center,
    rotationDegrees: rect.ccwRotationDegrees ?? 0,
  })
  const dx = Math.max(Math.abs(localPoint.x) - rect.width / 2, 0)
  const dy = Math.max(Math.abs(localPoint.y) - rect.height / 2, 0)
  return Math.hypot(dx, dy) - via.padDiameterMm / 2
}

export function primitiveIsInsideBoard({
  primitive,
  boardBounds,
  boardOutline,
  boardEdgeClearanceMm,
}: {
  primitive: HybridCopperPrimitive
  boardBounds: HybridBoardBounds
  boardOutline: readonly HybridBoardPoint[]
  boardEdgeClearanceMm: number
}): boolean {
  const radius =
    primitive.kind === "segment"
      ? primitive.widthMm / 2 + boardEdgeClearanceMm
      : primitive.padDiameterMm / 2 + boardEdgeClearanceMm
  const points =
    primitive.kind === "segment"
      ? [primitive.start, primitive.end]
      : [{ x: primitive.x, y: primitive.y }]
  if (
    points.some(
      (point) =>
        point.x - radius < boardBounds.minX - GEOMETRY_EPSILON ||
        point.x + radius > boardBounds.maxX + GEOMETRY_EPSILON ||
        point.y - radius < boardBounds.minY - GEOMETRY_EPSILON ||
        point.y + radius > boardBounds.maxY + GEOMETRY_EPSILON,
    )
  ) {
    return false
  }
  if (boardOutline.length < 3) return true
  if (points.some((point) => !pointIsInsidePolygon({ point, polygon: boardOutline }))) {
    return false
  }
  for (let edgeIndex = 0; edgeIndex < boardOutline.length; edgeIndex++) {
    const edgeStart = boardOutline[edgeIndex]!
    const edgeEnd = boardOutline[(edgeIndex + 1) % boardOutline.length]!
    const distance =
      primitive.kind === "segment"
        ? segmentToSegmentDistance({
            firstStart: primitive.start,
            firstEnd: primitive.end,
            secondStart: edgeStart,
            secondEnd: edgeEnd,
          })
        : pointToSegmentDistance({
            point: primitive,
            start: edgeStart,
            end: edgeEnd,
          })
    if (distance + GEOMETRY_EPSILON < radius) return false
  }
  return true
}

function rotatePointToLocal({
  point,
  center,
  rotationDegrees,
}: {
  point: HybridCopperPoint
  center: HybridCopperPoint
  rotationDegrees: number
}): HybridCopperPoint {
  const radians = (-rotationDegrees * Math.PI) / 180
  const x = point.x - center.x
  const y = point.y - center.y
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians),
  }
}

function segmentToAxisAlignedRectDistance({
  start,
  end,
  halfWidth,
  halfHeight,
}: {
  start: HybridCopperPoint
  end: HybridCopperPoint
  halfWidth: number
  halfHeight: number
}): number {
  if (
    pointIsInsideAxisAlignedRect({ point: start, halfWidth, halfHeight }) ||
    pointIsInsideAxisAlignedRect({ point: end, halfWidth, halfHeight })
  ) {
    return 0
  }
  const corners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]
  let minimumDistance = Number.POSITIVE_INFINITY
  for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex++) {
    minimumDistance = Math.min(
      minimumDistance,
      segmentToSegmentDistance({
        firstStart: start,
        firstEnd: end,
        secondStart: corners[cornerIndex]!,
        secondEnd: corners[(cornerIndex + 1) % corners.length]!,
      }),
    )
  }
  return minimumDistance
}

function pointIsInsideAxisAlignedRect({
  point,
  halfWidth,
  halfHeight,
}: {
  point: HybridCopperPoint
  halfWidth: number
  halfHeight: number
}): boolean {
  return (
    Math.abs(point.x) <= halfWidth + GEOMETRY_EPSILON &&
    Math.abs(point.y) <= halfHeight + GEOMETRY_EPSILON
  )
}

function pointIsInsidePolygon({
  point,
  polygon,
}: {
  point: HybridCopperPoint
  polygon: readonly HybridBoardPoint[]
}): boolean {
  let inside = false
  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex++
  ) {
    const current = polygon[currentIndex]!
    const previous = polygon[previousIndex]!
    if (
      Math.abs(
        orientation({ start: previous, end: current, point }),
      ) <= GEOMETRY_EPSILON &&
      pointIsOnSegment({ point, start: previous, end: current })
    ) {
      return true
    }
    const crosses =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x
    if (crosses) inside = !inside
  }
  return inside
}

function segmentToSegmentDistance({
  firstStart,
  firstEnd,
  secondStart,
  secondEnd,
}: {
  firstStart: HybridCopperPoint
  firstEnd: HybridCopperPoint
  secondStart: HybridCopperPoint
  secondEnd: HybridCopperPoint
}): number {
  if (
    segmentsIntersect({ firstStart, firstEnd, secondStart, secondEnd })
  ) {
    return 0
  }
  return Math.min(
    pointToSegmentDistance({
      point: firstStart,
      start: secondStart,
      end: secondEnd,
    }),
    pointToSegmentDistance({
      point: firstEnd,
      start: secondStart,
      end: secondEnd,
    }),
    pointToSegmentDistance({
      point: secondStart,
      start: firstStart,
      end: firstEnd,
    }),
    pointToSegmentDistance({
      point: secondEnd,
      start: firstStart,
      end: firstEnd,
    }),
  )
}

function segmentsIntersect({
  firstStart,
  firstEnd,
  secondStart,
  secondEnd,
}: {
  firstStart: HybridCopperPoint
  firstEnd: HybridCopperPoint
  secondStart: HybridCopperPoint
  secondEnd: HybridCopperPoint
}): boolean {
  const firstA = orientation({ start: firstStart, end: firstEnd, point: secondStart })
  const firstB = orientation({ start: firstStart, end: firstEnd, point: secondEnd })
  const secondA = orientation({ start: secondStart, end: secondEnd, point: firstStart })
  const secondB = orientation({ start: secondStart, end: secondEnd, point: firstEnd })
  if (
    Math.sign(firstA) !== Math.sign(firstB) &&
    Math.sign(secondA) !== Math.sign(secondB)
  ) {
    return true
  }
  return (
    (Math.abs(firstA) <= GEOMETRY_EPSILON &&
      pointIsOnSegment({ point: secondStart, start: firstStart, end: firstEnd })) ||
    (Math.abs(firstB) <= GEOMETRY_EPSILON &&
      pointIsOnSegment({ point: secondEnd, start: firstStart, end: firstEnd })) ||
    (Math.abs(secondA) <= GEOMETRY_EPSILON &&
      pointIsOnSegment({ point: firstStart, start: secondStart, end: secondEnd })) ||
    (Math.abs(secondB) <= GEOMETRY_EPSILON &&
      pointIsOnSegment({ point: firstEnd, start: secondStart, end: secondEnd }))
  )
}

function orientation({
  start,
  end,
  point,
}: {
  start: HybridCopperPoint
  end: HybridCopperPoint
  point: HybridCopperPoint
}): number {
  return (
    (end.x - start.x) * (point.y - start.y) -
    (end.y - start.y) * (point.x - start.x)
  )
}

function pointIsOnSegment({
  point,
  start,
  end,
}: {
  point: HybridCopperPoint
  start: HybridCopperPoint
  end: HybridCopperPoint
}): boolean {
  return (
    point.x >= Math.min(start.x, end.x) - GEOMETRY_EPSILON &&
    point.x <= Math.max(start.x, end.x) + GEOMETRY_EPSILON &&
    point.y >= Math.min(start.y, end.y) - GEOMETRY_EPSILON &&
    point.y <= Math.max(start.y, end.y) + GEOMETRY_EPSILON
  )
}

function pointToSegmentDistance({
  point,
  start,
  end,
}: {
  point: HybridCopperPoint
  start: HybridCopperPoint
  end: HybridCopperPoint
}): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared <= GEOMETRY_EPSILON) {
    return pointDistance({ first: point, second: start })
  }
  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        lengthSquared,
    ),
  )
  return pointDistance({
    first: point,
    second: { x: start.x + projection * dx, y: start.y + projection * dy },
  })
}

function pointDistance({
  first,
  second,
}: {
  first: HybridCopperPoint
  second: HybridCopperPoint
}): number {
  return Math.hypot(second.x - first.x, second.y - first.y)
}
