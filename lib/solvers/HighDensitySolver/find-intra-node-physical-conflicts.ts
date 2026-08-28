import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type Point2 = { x: number; y: number }
type Segment2 = { a: Point2; b: Point2; z: number }

export type IntraNodePhysicalConflict = {
  routeA: string
  routeB: string
}

const EPSILON = 1e-8

const dot = (ax: number, ay: number, bx: number, by: number): number =>
  ax * bx + ay * by

const pointDistance = (a: Point2, b: Point2): number =>
  Math.hypot(a.x - b.x, a.y - b.y)

const pointToSegmentDistance = (
  point: Point2,
  a: Point2,
  b: Point2,
): number => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared < EPSILON) return pointDistance(point, a)
  const t = Math.max(
    0,
    Math.min(1, dot(point.x - a.x, point.y - a.y, dx, dy) / lengthSquared),
  )
  return pointDistance(point, { x: a.x + dx * t, y: a.y + dy * t })
}

const orientation = (a: Point2, b: Point2, c: Point2): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

const segmentsProperlyIntersect = (
  a: Point2,
  b: Point2,
  c: Point2,
  d: Point2,
): boolean => {
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  return (
    ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))
  )
}

const segmentDistance = (
  a: Point2,
  b: Point2,
  c: Point2,
  d: Point2,
): number => {
  if (segmentsProperlyIntersect(a, b, c, d)) return 0
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b),
  )
}

const getSegments = (route: HighDensityIntraNodeRoute): Segment2[] => {
  const segments: Segment2[] = []
  for (let index = 1; index < route.route.length; index += 1) {
    const a = route.route[index - 1]!
    const b = route.route[index]!
    if (a.z !== b.z || pointDistance(a, b) < EPSILON) continue
    segments.push({ a, b, z: a.z })
  }
  return segments
}

const routesHavePhysicalConflict = (
  routeA: HighDensityIntraNodeRoute,
  routeB: HighDensityIntraNodeRoute,
  clearance: number,
): boolean => {
  const rootA = routeA.rootConnectionName ?? routeA.connectionName
  const rootB = routeB.rootConnectionName ?? routeB.connectionName
  if (rootA === rootB) return false

  const segmentsA = getSegments(routeA)
  const segmentsB = getSegments(routeB)
  const traceRequired =
    routeA.traceThickness / 2 + routeB.traceThickness / 2 + clearance
  for (const segmentA of segmentsA) {
    for (const segmentB of segmentsB) {
      if (segmentA.z !== segmentB.z) continue
      const distance = segmentDistance(
        segmentA.a,
        segmentA.b,
        segmentB.a,
        segmentB.b,
      )
      if (distance + EPSILON < traceRequired) return true
    }
  }

  const viaRequired =
    routeA.viaDiameter / 2 + routeB.viaDiameter / 2 + clearance
  for (const viaA of routeA.vias) {
    for (const viaB of routeB.vias) {
      if (pointDistance(viaA, viaB) + EPSILON < viaRequired) return true
    }
  }

  for (const viaA of routeA.vias) {
    const required =
      routeA.viaDiameter / 2 + routeB.traceThickness / 2 + clearance
    for (const segmentB of segmentsB) {
      if (
        pointToSegmentDistance(viaA, segmentB.a, segmentB.b) + EPSILON <
        required
      ) {
        return true
      }
    }
  }

  for (const viaB of routeB.vias) {
    const required =
      routeB.viaDiameter / 2 + routeA.traceThickness / 2 + clearance
    for (const segmentA of segmentsA) {
      if (
        pointToSegmentDistance(viaB, segmentA.a, segmentA.b) + EPSILON <
        required
      ) {
        return true
      }
    }
  }
  return false
}

export const findIntraNodePhysicalConflicts = (
  routes: HighDensityIntraNodeRoute[],
  clearance = 0.1,
): IntraNodePhysicalConflict[] => {
  const conflicts: IntraNodePhysicalConflict[] = []
  for (let indexA = 0; indexA < routes.length; indexA += 1) {
    const routeA = routes[indexA]!
    for (let indexB = indexA + 1; indexB < routes.length; indexB += 1) {
      const routeB = routes[indexB]!
      if (!routesHavePhysicalConflict(routeA, routeB, clearance)) continue
      conflicts.push({
        routeA: routeA.connectionName,
        routeB: routeB.connectionName,
      })
    }
  }
  return conflicts
}
