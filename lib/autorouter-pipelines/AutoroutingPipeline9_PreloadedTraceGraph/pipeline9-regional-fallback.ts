import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { classifyPointInBounds } from "lib/utils/classifyPointInBounds"
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
  fixedObstacleRoutes: PreloadedHighDensityRoute[]
}

export type RouteSegmentInterval = {
  startSegmentIndex: number
  endSegmentIndex: number
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

const clippedSegmentEntersNodeInterior = (
  clippedSegment: { start: RoutePoint; end: RoutePoint } | null,
  bounds: NodeBounds,
): boolean => {
  if (!clippedSegment) return false
  if (
    Math.hypot(
      clippedSegment.end.x - clippedSegment.start.x,
      clippedSegment.end.y - clippedSegment.start.y,
    ) > POINT_EPSILON
  ) {
    return true
  }
  return (
    classifyPointInBounds({ point: clippedSegment.start, bounds }) === "inside"
  )
}

export const createRegionalFallbackProblemForRouteSegmentInterval = ({
  node,
  sourceRoute,
  interval,
}: {
  node: NodeWithPortPoints
  sourceRoute: PreloadedHighDensityRoute
  interval: RouteSegmentInterval
}): RegionalFallbackProblem | undefined => {
  const { startSegmentIndex, endSegmentIndex } = interval
  if (
    !Number.isInteger(startSegmentIndex) ||
    !Number.isInteger(endSegmentIndex) ||
    startSegmentIndex < 0 ||
    endSegmentIndex < startSegmentIndex ||
    endSegmentIndex >= sourceRoute.route.length - 1
  ) {
    return undefined
  }
  const bounds = getNodeBounds(node)
  for (
    let segmentIndex = 0;
    segmentIndex < sourceRoute.route.length - 1;
    segmentIndex++
  ) {
    if (segmentIndex >= startSegmentIndex && segmentIndex <= endSegmentIndex) {
      continue
    }
    if (
      clippedSegmentEntersNodeInterior(
        clipRouteSegmentToBounds(
          sourceRoute.route[segmentIndex]!,
          sourceRoute.route[segmentIndex + 1]!,
          bounds,
        ),
        bounds,
      )
    ) {
      return undefined
    }
  }
  const startClip = clipRouteSegmentToBounds(
    sourceRoute.route[startSegmentIndex]!,
    sourceRoute.route[startSegmentIndex + 1]!,
    bounds,
  )
  const endClip = clipRouteSegmentToBounds(
    sourceRoute.route[endSegmentIndex]!,
    sourceRoute.route[endSegmentIndex + 1]!,
    bounds,
  )
  if (!startClip || !endClip) return undefined
  if (
    classifyPointInBounds({ point: startClip.start, bounds }) !==
      "on-boundary" ||
    classifyPointInBounds({ point: endClip.end, bounds }) !== "on-boundary"
  ) {
    return undefined
  }
  const section: FixedRouteSection = {
    sourceRoutes: [sourceRoute],
    start: { segmentIndex: startSegmentIndex, point: startClip.start },
    end: { segmentIndex: endSegmentIndex, point: endClip.end },
  }
  if (pointsAreEqual(section.start.point, section.end.point)) return undefined
  const fallbackPortPair = createFallbackPortPair(section)
  return {
    nodeWithPortPoints: {
      ...node,
      portPoints: [...node.portPoints, ...fallbackPortPair],
      portPointsInPairs: [...(node.portPointsInPairs ?? []), fallbackPortPair],
    },
    fixedRouteSectionsByConnectionName: new Map([
      [sourceRoute.connectionName, section],
    ]),
    fixedObstacleRoutes: [],
  }
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
  const fixedObstacleRoutes = localSlices
    .map((slice) => slice.sourceRoute)
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
  const firstSourceRoute = section.sourceRoutes[0]!
  const lastSourceRoute = section.sourceRoutes.at(-1)!
  const replacementPoints = orientReplacementPoints(replacement, section)
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
    if (pointsAreEqual(previousPoint, point)) return
    if (
      previousPoint.z !== point.z &&
      (Math.abs(previousPoint.x - point.x) > POINT_EPSILON ||
        Math.abs(previousPoint.y - point.y) > POINT_EPSILON)
    ) {
      const impliedTransitionPoint = { ...point, z: previousPoint.z }
      if (!pointsAreEqual(previousPoint, impliedTransitionPoint)) {
        route.push(impliedTransitionPoint)
        mutatedSegments.push(mutated)
      }
    }
    if (!pointsAreEqual(route.at(-1)!, point)) {
      route.push(point)
      mutatedSegments.push(mutated)
    }
  }

  appendPoint(firstSourceRoute.route[0]!, false)
  for (
    let pointIndex = 1;
    pointIndex <= section.start.segmentIndex;
    pointIndex++
  ) {
    appendPoint(
      firstSourceRoute.route[pointIndex]!,
      getSourceSegmentMutation(firstSourceRoute, pointIndex - 1),
    )
  }
  appendPoint(
    section.start.point,
    getSourceSegmentMutation(firstSourceRoute, section.start.segmentIndex),
  )
  const segmentCountBeforeReplacement = mutatedSegments.length
  for (const replacementPoint of replacementPoints.slice(1, -1)) {
    appendPoint(replacementPoint, replacementIsMutated)
  }
  appendPoint(section.end.point, replacementIsMutated)
  const replacementProducedSegment =
    mutatedSegments.length > segmentCountBeforeReplacement
  for (
    let pointIndex = section.end.segmentIndex + 1;
    pointIndex < lastSourceRoute.route.length;
    pointIndex++
  ) {
    appendPoint(
      lastSourceRoute.route[pointIndex]!,
      getSourceSegmentMutation(lastSourceRoute, pointIndex - 1),
    )
  }

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
