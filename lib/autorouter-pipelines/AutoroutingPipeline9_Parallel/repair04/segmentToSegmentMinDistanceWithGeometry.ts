/** Scalar derivative of @tscircuit/math-utils segment-distance and line-intersections (MIT). */
type Point = { x: number; y: number }

export type SegmentDistanceGeometry = {
  aX: number
  aY: number
  bX: number
  bY: number
  dx: number
  dy: number
  l2: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Cache repeated differences without changing the math-utils operation order. */
export function updateSegmentDistanceGeometry(
  geometry: SegmentDistanceGeometry,
  a: Point,
  b: Point,
): void {
  geometry.aX = a.x
  geometry.aY = a.y
  geometry.bX = b.x
  geometry.bY = b.y
  geometry.dx = b.x - a.x
  geometry.dy = b.y - a.y
  geometry.l2 = geometry.dx ** 2 + geometry.dy ** 2
  geometry.minX = Math.min(a.x, b.x)
  geometry.minY = Math.min(a.y, b.y)
  geometry.maxX = Math.max(a.x, b.x)
  geometry.maxY = Math.max(a.y, b.y)
}

export function prepareSegmentDistanceGeometry(
  a: Point,
  b: Point,
): SegmentDistanceGeometry {
  const geometry: SegmentDistanceGeometry = { aX: 0, aY: 0, bX: 0, bY: 0,
    dx: 0, dy: 0, l2: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 }
  updateSegmentDistanceGeometry(geometry, a, b)
  return geometry
}

function pointToPreparedSegmentDistance(
  x: number,
  y: number,
  segment: SegmentDistanceGeometry,
): number {
  if (segment.l2 === 0) {
    const dx = x - segment.aX
    const dy = y - segment.aY
    return Math.sqrt(dx * dx + dy * dy)
  }
  let t = ((x - segment.aX) * segment.dx + (y - segment.aY) * segment.dy) / segment.l2
  t = Math.max(0, Math.min(1, t))
  const projectionX = segment.aX + t * segment.dx
  const projectionY = segment.aY + t * segment.dy
  const dx = x - projectionX
  const dy = y - projectionY
  return Math.sqrt(dx * dx + dy * dy)
}

function preparedSegmentsIntersect(
  edge: SegmentDistanceGeometry,
  copper: SegmentDistanceGeometry,
): boolean {
  const first = edge.dy * (copper.aX - edge.bX) - edge.dx * (copper.aY - edge.bY)
  const second = edge.dy * (copper.bX - edge.bX) - edge.dx * (copper.bY - edge.bY)
  const third = copper.dy * (edge.aX - copper.bX) - copper.dx * (edge.aY - copper.bY)
  const fourth = copper.dy * (edge.bX - copper.bX) - copper.dx * (edge.bY - copper.bY)
  const o1 = first === 0 ? 0 : first > 0 ? 1 : 2
  const o2 = second === 0 ? 0 : second > 0 ? 1 : 2
  const o3 = third === 0 ? 0 : third > 0 ? 1 : 2
  const o4 = fourth === 0 ? 0 : fourth > 0 ? 1 : 2
  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && copper.aX <= edge.maxX && copper.aX >= edge.minX && copper.aY <= edge.maxY && copper.aY >= edge.minY) return true
  if (o2 === 0 && copper.bX <= edge.maxX && copper.bX >= edge.minX && copper.bY <= edge.maxY && copper.bY >= edge.minY) return true
  if (o3 === 0 && edge.aX <= copper.maxX && edge.aX >= copper.minX && edge.aY <= copper.maxY && edge.aY >= copper.minY) return true
  if (o4 === 0 && edge.bX <= copper.maxX && edge.bX >= copper.minX && edge.bY <= copper.maxY && edge.bY >= copper.minY) return true
  return false
}

/** Exact derivative of math-utils segment distance with prepared scalar geometry. */
export function segmentToSegmentMinDistanceWithGeometry(
  edge: SegmentDistanceGeometry,
  copper: SegmentDistanceGeometry,
): number {
  if (edge.aX === edge.bX && edge.aY === edge.bY)
    return pointToPreparedSegmentDistance(edge.aX, edge.aY, copper)
  if (copper.aX === copper.bX && copper.aY === copper.bY)
    return pointToPreparedSegmentDistance(copper.aX, copper.aY, edge)
  if (preparedSegmentsIntersect(edge, copper)) return 0
  return Math.min(
    pointToPreparedSegmentDistance(edge.aX, edge.aY, copper),
    pointToPreparedSegmentDistance(edge.bX, edge.bY, copper),
    pointToPreparedSegmentDistance(copper.aX, copper.aY, edge),
    pointToPreparedSegmentDistance(copper.bX, copper.bY, edge),
  )
}
