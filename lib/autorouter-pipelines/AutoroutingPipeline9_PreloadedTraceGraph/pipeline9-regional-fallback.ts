import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { PreloadedHighDensityRoute } from "./convert-preloaded-traces-to-hd-routes"

type RoutePoint = HighDensityRoute["route"][number]

type NodeBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type RouteLocation = {
  segmentIndex: number
  point: RoutePoint
}

type FixedRouteSlice = {
  sourceRoute: PreloadedHighDensityRoute
  start: RouteLocation
  end: RouteLocation
}

export type FixedRouteSection = {
  sourceRoutes: PreloadedHighDensityRoute[]
  start: RouteLocation
  end: RouteLocation
}

export type RegionalFallbackProblem = {
  nodeWithPortPoints: NodeWithPortPoints
  fixedRouteSectionsByConnectionName: Map<string, FixedRouteSection>
}

const POINT_EPSILON = 1e-9

const getNodeBounds = (node: NodeWithPortPoints): NodeBounds => ({
  minX: node.center.x - node.width / 2,
  maxX: node.center.x + node.width / 2,
  minY: node.center.y - node.height / 2,
  maxY: node.center.y + node.height / 2,
})

const isPointInsideBounds = (point: RoutePoint, bounds: NodeBounds) =>
  point.x >= bounds.minX - POINT_EPSILON &&
  point.x <= bounds.maxX + POINT_EPSILON &&
  point.y >= bounds.minY - POINT_EPSILON &&
  point.y <= bounds.maxY + POINT_EPSILON

const interpolateRoutePoint = (
  start: RoutePoint,
  end: RoutePoint,
  t: number,
): RoutePoint => {
  if (t <= POINT_EPSILON) return start
  if (t >= 1 - POINT_EPSILON) return end
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: start.z,
  }
}

const clipRouteSegmentToBounds = (
  start: RoutePoint,
  end: RoutePoint,
  bounds: NodeBounds,
): { start: RoutePoint; end: RoutePoint } | null => {
  const dx = end.x - start.x
  const dy = end.y - start.y

  if (Math.abs(dx) <= POINT_EPSILON && Math.abs(dy) <= POINT_EPSILON) {
    return isPointInsideBounds(start, bounds) &&
      isPointInsideBounds(end, bounds)
      ? { start, end }
      : null
  }

  let entryT = 0
  let exitT = 1
  const constraints: Array<[number, number]> = [
    [-dx, start.x - bounds.minX],
    [dx, bounds.maxX - start.x],
    [-dy, start.y - bounds.minY],
    [dy, bounds.maxY - start.y],
  ]

  for (const [direction, distanceToBoundary] of constraints) {
    if (Math.abs(direction) <= POINT_EPSILON) {
      if (distanceToBoundary < 0) return null
      continue
    }

    const boundaryT = distanceToBoundary / direction
    if (direction < 0) {
      entryT = Math.max(entryT, boundaryT)
    } else {
      exitT = Math.min(exitT, boundaryT)
    }
    if (entryT > exitT + POINT_EPSILON) return null
  }

  return {
    start: interpolateRoutePoint(start, end, entryT),
    end: interpolateRoutePoint(start, end, exitT),
  }
}

const getFixedRouteSlice = (
  route: PreloadedHighDensityRoute,
  node: NodeWithPortPoints,
): FixedRouteSlice | null => {
  const bounds = getNodeBounds(node)
  let start: RouteLocation | undefined
  let end: RouteLocation | undefined

  for (
    let segmentIndex = 0;
    segmentIndex < route.route.length - 1;
    segmentIndex++
  ) {
    const clippedSegment = clipRouteSegmentToBounds(
      route.route[segmentIndex]!,
      route.route[segmentIndex + 1]!,
      bounds,
    )
    if (!clippedSegment) continue

    start ??= {
      segmentIndex,
      point: clippedSegment.start,
    }
    end = {
      segmentIndex,
      point: clippedSegment.end,
    }
  }

  if (!start || !end) return null
  if (
    Math.abs(start.point.x - end.point.x) <= POINT_EPSILON &&
    Math.abs(start.point.y - end.point.y) <= POINT_EPSILON &&
    start.point.z === end.point.z
  ) {
    return null
  }

  return {
    sourceRoute: route,
    start,
    end,
  }
}

const createFallbackPortPair = (
  section: FixedRouteSection,
): [PortPoint, PortPoint] => {
  const sourceRoute = section.sourceRoutes[0]!
  const portPointIdPrefix = `pipeline9_fallback:${sourceRoute.connectionName}`
  const startPortPointId = `${portPointIdPrefix}:start`
  const endPortPointId = `${portPointIdPrefix}:end`
  return [
    {
      ...section.start.point,
      portPointId: startPortPointId,
      nextPortPointId: endPortPointId,
      connectionName: sourceRoute.connectionName,
      rootConnectionName: sourceRoute.rootConnectionName,
    },
    {
      ...section.end.point,
      portPointId: endPortPointId,
      prevPortPointId: startPortPointId,
      connectionName: sourceRoute.connectionName,
      rootConnectionName: sourceRoute.rootConnectionName,
    },
  ]
}

const pointsAreEqual = (a: RoutePoint, b: RoutePoint) =>
  Math.abs(a.x - b.x) <= POINT_EPSILON &&
  Math.abs(a.y - b.y) <= POINT_EPSILON &&
  a.z === b.z

const fixedRouteSlicesAreContiguous = (
  previous: FixedRouteSlice,
  next: FixedRouteSlice,
): boolean =>
  previous.sourceRoute.preloadedTraceIndex ===
    next.sourceRoute.preloadedTraceIndex &&
  pointsAreEqual(previous.sourceRoute.route.at(-1)!, next.sourceRoute.route[0]!)

/**
 * Builds the regular high-density input used only after B01 fails. Fixed
 * each contiguous section of pre-routed copper crossing the node becomes one
 * ordinary port pair, which lets the portfolio reroute it together with the
 * new traces in that region.
 */
export const createRegionalFallbackProblem = (
  node: NodeWithPortPoints,
  fixedRoutes: PreloadedHighDensityRoute[],
): RegionalFallbackProblem => {
  const fixedRouteSectionsByConnectionName = new Map<
    string,
    FixedRouteSection
  >()
  const fallbackPortPairs: Array<[PortPoint, PortPoint]> = []

  const slices = fixedRoutes
    .map((fixedRoute) => getFixedRouteSlice(fixedRoute, node))
    .filter((slice): slice is FixedRouteSlice => slice !== null)
    .sort(
      (a, b) =>
        a.sourceRoute.preloadedTraceIndex - b.sourceRoute.preloadedTraceIndex ||
        a.sourceRoute.preloadedRouteIndex - b.sourceRoute.preloadedRouteIndex,
    )
  const sections: FixedRouteSection[] = []

  for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex++) {
    const slice = slices[sliceIndex]!
    const previousSlice = slices[sliceIndex - 1]
    const currentSection = sections.at(-1)
    if (
      previousSlice &&
      currentSection &&
      fixedRouteSlicesAreContiguous(previousSlice, slice)
    ) {
      currentSection.sourceRoutes.push(slice.sourceRoute)
      currentSection.end = slice.end
      continue
    }
    sections.push({
      sourceRoutes: [slice.sourceRoute],
      start: slice.start,
      end: slice.end,
    })
  }

  for (const section of sections) {
    const connectionName = section.sourceRoutes[0]!.connectionName
    if (fixedRouteSectionsByConnectionName.has(connectionName)) {
      throw new Error(
        `Pipeline9 regional fallback found duplicate fixed route section identity "${connectionName}"`,
      )
    }
    fixedRouteSectionsByConnectionName.set(connectionName, section)
    fallbackPortPairs.push(createFallbackPortPair(section))
  }

  return {
    nodeWithPortPoints: {
      ...node,
      portPoints: [
        ...node.portPoints,
        ...fallbackPortPairs.flatMap((pair) => pair),
      ],
      portPointsInPairs: [
        ...(node.portPointsInPairs ?? []),
        ...fallbackPortPairs,
      ],
    },
    fixedRouteSectionsByConnectionName,
  }
}

const dedupeAdjacentPoints = (points: RoutePoint[]): RoutePoint[] => {
  const deduped: RoutePoint[] = []
  for (const point of points) {
    if (deduped.at(-1) && pointsAreEqual(deduped.at(-1)!, point)) continue
    deduped.push(point)
  }
  return deduped
}

const materializeImpliedLayerTransitions = (
  points: RoutePoint[],
): RoutePoint[] => {
  const materialized: RoutePoint[] = []
  for (const point of points) {
    const previousPoint = materialized.at(-1)
    if (
      previousPoint &&
      previousPoint.z !== point.z &&
      (Math.abs(previousPoint.x - point.x) > POINT_EPSILON ||
        Math.abs(previousPoint.y - point.y) > POINT_EPSILON)
    ) {
      materialized.push({ ...point, z: previousPoint.z })
    }
    materialized.push(point)
  }
  return materialized
}

const orientReplacementPoints = (
  replacement: HighDensityRoute,
  section: FixedRouteSection,
): RoutePoint[] => {
  const points = replacement.route
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last) {
    throw new Error(
      `Pipeline9 regional fallback produced an empty replacement for "${section.sourceRoutes[0]!.connectionName}"`,
    )
  }

  const forwardDistance =
    Math.hypot(
      first.x - section.start.point.x,
      first.y - section.start.point.y,
    ) + Math.hypot(last.x - section.end.point.x, last.y - section.end.point.y)
  const reverseDistance =
    Math.hypot(last.x - section.start.point.x, last.y - section.start.point.y) +
    Math.hypot(first.x - section.end.point.x, first.y - section.end.point.y)

  return reverseDistance < forwardDistance ? [...points].reverse() : points
}

const getViasFromRoutePoints = (
  points: RoutePoint[],
): Array<{ x: number; y: number }> => {
  const vias: Array<{ x: number; y: number }> = []
  for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex++) {
    const start = points[pointIndex]!
    const end = points[pointIndex + 1]!
    if (
      start.z !== end.z &&
      Math.abs(start.x - end.x) <= POINT_EPSILON &&
      Math.abs(start.y - end.y) <= POINT_EPSILON
    ) {
      vias.push({ x: end.x, y: end.y })
    }
  }
  return vias
}

/** Splices a regular high-density replacement into a contiguous fixed route section. */
export const spliceFixedRouteSection = (
  section: FixedRouteSection,
  replacement: HighDensityRoute,
): PreloadedHighDensityRoute => {
  const firstSourceRoute = section.sourceRoutes[0]!
  const lastSourceRoute = section.sourceRoutes.at(-1)!
  const replacementPoints = materializeImpliedLayerTransitions(
    orientReplacementPoints(replacement, section),
  )
  const route = dedupeAdjacentPoints([
    ...firstSourceRoute.route.slice(0, section.start.segmentIndex + 1),
    section.start.point,
    ...replacementPoints.slice(1, -1),
    section.end.point,
    ...lastSourceRoute.route.slice(section.end.segmentIndex + 1),
  ])

  return {
    ...firstSourceRoute,
    traceThickness: Math.max(
      ...section.sourceRoutes.map((sourceRoute) => sourceRoute.traceThickness),
    ),
    viaDiameter: Math.max(
      ...section.sourceRoutes.map((sourceRoute) => sourceRoute.viaDiameter),
    ),
    route,
    vias: getViasFromRoutePoints(route),
  }
}
