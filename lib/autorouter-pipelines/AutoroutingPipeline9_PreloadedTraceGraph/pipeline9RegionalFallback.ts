import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import {
  BOUNDARY_COORDINATE_TOLERANCE_MM,
  classifyPointInBounds,
} from "lib/utils/classifyPointInBounds"
import type { PreloadedHighDensityRoute } from "./convertPreloadedTraceToHdRoutes"

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
  fixedObstacleRoutes: PreloadedHighDensityRoute[]
}

const POINT_EPSILON = 1e-9

const getNodeBounds = (node: NodeWithPortPoints): NodeBounds => ({
  minX: node.center.x - node.width / 2,
  maxX: node.center.x + node.width / 2,
  minY: node.center.y - node.height / 2,
  maxY: node.center.y + node.height / 2,
})

export const areAllPortPointsOnNodeBoundary = (
  node: NodeWithPortPoints,
): boolean => {
  const bounds = getNodeBounds(node)
  return node.portPoints.every(
    (portPoint) =>
      classifyPointInBounds({ point: portPoint, bounds }) === "on-boundary",
  )
}

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

const fixedRouteSliceTouchesTargetLayer = (
  slice: FixedRouteSlice,
  targetLayers: ReadonlySet<number>,
): boolean => {
  if (targetLayers.size === 0) return true
  const routePointsInsideNode = [
    slice.start.point,
    ...slice.sourceRoute.route.slice(
      slice.start.segmentIndex + 1,
      slice.end.segmentIndex + 1,
    ),
    slice.end.point,
  ]
  return routePointsInsideNode.some((routePoint) =>
    targetLayers.has(routePoint.z),
  )
}

/**
 * Builds the regular high-density input used only after B01 fails. Fixed
 * each contiguous section of pre-routed copper crossing the node on a target
 * connection layer becomes one ordinary port pair, which lets the portfolio
 * reroute it together with the new traces in that region. Local fixed routes
 * on other layers remain immutable obstacles unless an immutable-first solve
 * proves that an exact route is the blocker and explicitly promotes it.
 * Repair-only callers with no target port points continue to make every
 * crossing section movable.
 */
export const createRegionalFallbackProblem = (
  node: NodeWithPortPoints,
  fixedRoutes: PreloadedHighDensityRoute[],
  promotedFixedRouteConnectionNames: ReadonlySet<string> = new Set(),
): RegionalFallbackProblem => {
  const fixedRouteSectionsByConnectionName = new Map<
    string,
    FixedRouteSection
  >()
  const fallbackPortPairs: Array<[PortPoint, PortPoint]> = []
  const targetLayers = new Set(node.portPoints.map((portPoint) => portPoint.z))

  const localSlices = fixedRoutes
    .map((fixedRoute) => getFixedRouteSlice(fixedRoute, node))
    .filter((slice): slice is FixedRouteSlice => slice !== null)
  const slices = localSlices
    .filter(
      (slice) =>
        slice.sourceRoute.isFixed !== true &&
        slice.sourceRoute.isThroughObstacle !== true &&
        (fixedRouteSliceTouchesTargetLayer(slice, targetLayers) ||
          promotedFixedRouteConnectionNames.has(
            slice.sourceRoute.connectionName,
          )),
    )
    .sort(
      (a, b) =>
        a.sourceRoute.preloadedTraceIndex - b.sourceRoute.preloadedTraceIndex ||
        a.sourceRoute.preloadedRouteIndex - b.sourceRoute.preloadedRouteIndex,
    )
  const movableFixedRoutes = new Set(slices.map((slice) => slice.sourceRoute))
  const hasImmutablePreload = fixedRoutes.some((route) => route.isFixed === true)
  const fixedObstacleRoutes = (hasImmutablePreload
    ? fixedRoutes
    : localSlices.map((slice) => slice.sourceRoute))
    .filter((route) => !movableFixedRoutes.has(route))
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
    // A zero-length slice still owns its position in a contiguous source
    // section, so a replacement spanning its neighbors must absorb it. An
    // isolated boundary contact cannot form a meaningful port pair. Retain
    // its copper as an obstacle rather than hiding it from the repair solver.
    if (
      section.start.point.z === section.end.point.z &&
      Math.hypot(
        section.start.point.x - section.end.point.x,
        section.start.point.y - section.end.point.y,
      ) <= BOUNDARY_COORDINATE_TOLERANCE_MM
    ) {
      fixedObstacleRoutes.push(...section.sourceRoutes)
      continue
    }
    const connectionName = section.sourceRoutes[0]!.connectionName
    if (fixedRouteSectionsByConnectionName.has(connectionName)) {
      throw new Error(
        `Pipeline9 regional fallback found duplicate fixed route section identity "${connectionName}"`,
      )
    }
    fixedRouteSectionsByConnectionName.set(connectionName, section)
    fallbackPortPairs.push(createFallbackPortPair(section))
  }

  if (hasImmutablePreload) {
    // Only the cut section moves. Keep its unchanged prefix and suffix in
    // the regional solver's physical copper context.
    const replacedRoutes = new Set([...fixedRouteSectionsByConnectionName.values()]
      .flatMap((section) => section.sourceRoutes))
    for (const slice of slices) {
      if (!replacedRoutes.has(slice.sourceRoute)) continue
      const source = slice.sourceRoute
      const prefix = source.route.slice(0, slice.start.segmentIndex + 1)
      const suffix = source.route.slice(slice.end.segmentIndex + 1)
      const startWidth = Math.max(
        source.route[slice.start.segmentIndex]!.traceThickness ?? source.traceThickness,
        source.route[slice.start.segmentIndex + 1]!.traceThickness ?? source.traceThickness,
      )
      const endWidth = Math.max(
        source.route[slice.end.segmentIndex]!.traceThickness ?? source.traceThickness,
        source.route[slice.end.segmentIndex + 1]!.traceThickness ?? source.traceThickness,
      )
      if (!prefix.length || !pointsAreEqual(prefix.at(-1)!, slice.start.point))
        prefix.push({ ...slice.start.point, traceThickness: startWidth })
      if (!suffix.length || !pointsAreEqual(suffix[0]!, slice.end.point))
        suffix.unshift({ ...slice.end.point, traceThickness: endWidth })
      for (const points of [prefix, suffix]) {
        if (points.length < 2) continue
        fixedObstacleRoutes.push({ ...source, route: points, vias: getViasFromRoutePoints(points) })
      }
    }

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
    fixedObstacleRoutes,
  }
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

  // A pure barrel's anchors share XY; their layers determine orientation.
  if (pointsAreEqual(last, section.start.point) &&
    pointsAreEqual(first, section.end.point)) return [...points].reverse()

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
): PreloadedHighDensityRoute =>
  spliceFixedRouteSectionWithMutationMask({
    section,
    replacement,
    sourceMutationMasks: new Map(),
    replacementIsMutated: false,
  }).route

export type SplicedFixedRouteWithMutationMask = {
  route: PreloadedHighDensityRoute
  mutatedSegments: boolean[]
  replacementProducedSegment: boolean
}

/**
 * Splices a replacement while carrying exact segment-level mutation
 * provenance through the untouched prefix and suffix.
 */
export const spliceFixedRouteSectionWithMutationMask = ({
  section,
  replacement,
  sourceMutationMasks,
  replacementIsMutated,
}: {
  section: FixedRouteSection
  replacement: HighDensityRoute
  sourceMutationMasks: ReadonlyMap<string, readonly boolean[]>
  replacementIsMutated: boolean
}): SplicedFixedRouteWithMutationMask => {
  const immutableSourceRoute = section.sourceRoutes.find(
    (sourceRoute) => sourceRoute.isFixed === true,
  )
  if (immutableSourceRoute) {
    throw new Error(
      `Pipeline9 cannot splice fixed native trace "${immutableSourceRoute.connectionName}"`,
    )
  }
  const firstSourceRoute = section.sourceRoutes[0]!
  const lastSourceRoute = section.sourceRoutes.at(-1)!
  const defaultTraceThickness = Math.max(...section.sourceRoutes.map((route) => route.traceThickness))
  const withWidth = (point: RoutePoint, traceThickness: number): RoutePoint => {
    if (point.traceThickness !== undefined || traceThickness === defaultTraceThickness) {
      return point
    }
    return { ...point, traceThickness }
  }
  const replacementPoints = orientReplacementPoints(replacement, section)
    .map((point) => withWidth(point, replacement.traceThickness))
  const firstSourcePoints = firstSourceRoute.route.map((point) => withWidth(point, firstSourceRoute.traceThickness))
  const lastSourcePoints = lastSourceRoute.route.map((point) => withWidth(point, lastSourceRoute.traceThickness))
  const route: RoutePoint[] = []
  const mutatedSegments: boolean[] = []

  const getSourceSegmentMutation = (
    sourceRoute: PreloadedHighDensityRoute,
    segmentIndex: number,
  ): boolean => {
    const mask = sourceMutationMasks.get(sourceRoute.connectionName)
    if (mask && mask.length !== sourceRoute.route.length - 1) {
      throw new Error(
        `Pipeline9 fixed route mutation mask for "${sourceRoute.connectionName}" has ${mask.length} segments, expected ${sourceRoute.route.length - 1}`,
      )
    }
    return mask?.[segmentIndex] ?? false
  }

  const appendPoint = (point: RoutePoint, mutated: boolean): void => {
    const previousPoint = route.at(-1)
    if (!previousPoint) {
      route.push(point)
      return
    }
    const sameXY = previousPoint.x === point.x && previousPoint.y === point.y
    if (sameXY && previousPoint.z === point.z && (previousPoint.traceThickness ?? defaultTraceThickness) === (point.traceThickness ?? defaultTraceThickness)) return
    if (previousPoint.z !== point.z && !sameXY) {
      const impliedTransitionPoint = { ...point, z: previousPoint.z }
      route.push(impliedTransitionPoint)
      mutatedSegments.push(mutated)
    }
    route.push(point)
    mutatedSegments.push(mutated)
  }

  appendPoint(firstSourcePoints[0]!, false)
  for (
    let pointIndex = 1;
    pointIndex <= section.start.segmentIndex;
    pointIndex++
  ) {
    appendPoint(
      firstSourcePoints[pointIndex]!,
      getSourceSegmentMutation(firstSourceRoute, pointIndex - 1),
    )
  }
  appendPoint(
    withWidth(section.start.point, Math.max(
      firstSourceRoute.route[section.start.segmentIndex]!.traceThickness ?? firstSourceRoute.traceThickness,
      firstSourceRoute.route[section.start.segmentIndex + 1]!.traceThickness ?? firstSourceRoute.traceThickness,
    )),
    getSourceSegmentMutation(firstSourceRoute, section.start.segmentIndex),
  )
  const segmentCountBeforeReplacement = mutatedSegments.length
  appendPoint(replacementPoints[0]!, replacementIsMutated)
  for (const replacementPoint of replacementPoints.slice(1, -1)) {
    appendPoint(replacementPoint, replacementIsMutated)
  }
  appendPoint(replacementPoints.at(-1)!, replacementIsMutated)
  appendPoint(withWidth(section.end.point, Math.max(
    lastSourceRoute.route[section.end.segmentIndex]!.traceThickness ?? lastSourceRoute.traceThickness,
    lastSourceRoute.route[section.end.segmentIndex + 1]!.traceThickness ?? lastSourceRoute.traceThickness,
  )),
    getSourceSegmentMutation(lastSourceRoute, section.end.segmentIndex),
  )
  const replacementProducedSegment =
    mutatedSegments.length > segmentCountBeforeReplacement
  for (
    let pointIndex = section.end.segmentIndex + 1;
    pointIndex < lastSourceRoute.route.length;
    pointIndex++
  ) {
    appendPoint(
      lastSourcePoints[pointIndex]!,
      getSourceSegmentMutation(lastSourceRoute, pointIndex - 1),
    )
  }

  // Coincident replacement points may collapse during splicing. Preserve
  // the original physical endpoints and their source metadata.
  route[0] = firstSourcePoints[0]!
  route[route.length - 1] = lastSourcePoints.at(-1)!

  if (mutatedSegments.length !== route.length - 1) {
    throw new Error(
      `Pipeline9 produced an invalid mutation mask while splicing "${firstSourceRoute.connectionName}"`,
    )
  }

  return {
    route: {
      ...firstSourceRoute,
      preloadedRoutePositionStart: firstSourceRoute.preloadedRoutePositionStart,
      preloadedRoutePositionEnd: lastSourceRoute.preloadedRoutePositionEnd,
      traceThickness: Math.max(
        ...section.sourceRoutes.map(
          (sourceRoute) => sourceRoute.traceThickness,
        ),
      ),
      viaDiameter: Math.max(
        ...section.sourceRoutes.map((sourceRoute) => sourceRoute.viaDiameter),
      ),
      route,
      vias: getViasFromRoutePoints(route),
    },
    mutatedSegments,
    replacementProducedSegment,
  }
}
