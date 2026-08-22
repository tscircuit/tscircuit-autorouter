import type { HighDensityRoute } from "lib/types/high-density-types"
import type { PreloadedHighDensityRoute } from "./convert-preloaded-traces-to-hd-routes"
import {
  type FixedRouteSection,
  spliceFixedRouteSection,
} from "./pipeline9-regional-fallback"

type RoutePoint = HighDensityRoute["route"][number]

type NormalizedFixedRoute = {
  route: PreloadedHighDensityRoute
  mutated: boolean
}

export type PreparedPipeline9MutationSection = {
  connectionName: string
  section: FixedRouteSection
  hdRoute: HighDensityRoute
}

export type PreparedPipeline9MutationSections = {
  sections: PreparedPipeline9MutationSection[]
  immutableHdRoutes: HighDensityRoute[]
  normalizedFixedRoutes: PreloadedHighDensityRoute[]
}

type PreparePipeline9MutationSectionsParams = {
  updatedFixedRoutes: PreloadedHighDensityRoute[]
  regionalMutationMasks: ReadonlyMap<string, readonly boolean[]>
}

type ApplyPipeline9MutationSectionsParams = {
  updatedFixedRoutes: PreloadedHighDensityRoute[]
  sections: PreparedPipeline9MutationSection[]
  simplifiedHdRoutes: HighDensityRoute[]
}

const POINT_EPSILON = 1e-6

const pointsAreEqual = (left: RoutePoint, right: RoutePoint): boolean =>
  Math.abs(left.x - right.x) <= POINT_EPSILON &&
  Math.abs(left.y - right.y) <= POINT_EPSILON &&
  left.z === right.z

const appendSectionRoutePoints = (
  points: RoutePoint[],
  nextPoints: RoutePoint[],
): void => {
  for (const point of nextPoints) {
    if (points.at(-1) && pointsAreEqual(points.at(-1)!, point)) continue
    points.push(point)
  }
}

const getViasFromRoutePoints = (
  route: RoutePoint[],
): Array<{ x: number; y: number }> =>
  route.slice(0, -1).flatMap((point, pointIndex) => {
    const nextPoint = route[pointIndex + 1]!
    return point.z !== nextPoint.z &&
      Math.abs(point.x - nextPoint.x) <= POINT_EPSILON &&
      Math.abs(point.y - nextPoint.y) <= POINT_EPSILON
      ? [{ x: nextPoint.x, y: nextPoint.y }]
      : []
  })

const getRoutePositionRange = (
  route: PreloadedHighDensityRoute,
): { start: number; end: number } => {
  const routePositionStart = route.preloadedRoutePositionStart
  const routePositionEnd = route.preloadedRoutePositionEnd
  if (routePositionStart === undefined || routePositionEnd === undefined) {
    throw new Error(
      `Pipeline9 fixed route "${route.connectionName}" is missing route-position metadata`,
    )
  }
  return {
    start: Math.min(routePositionStart, routePositionEnd),
    end: Math.max(routePositionStart, routePositionEnd),
  }
}

const compareFixedRoutes = (
  left: PreloadedHighDensityRoute,
  right: PreloadedHighDensityRoute,
): number => {
  const leftRange = getRoutePositionRange(left)
  const rightRange = getRoutePositionRange(right)
  return (
    left.preloadedTraceIndex - right.preloadedTraceIndex ||
    leftRange.start - rightRange.start ||
    leftRange.end - rightRange.end ||
    left.preloadedRouteIndex - right.preloadedRouteIndex ||
    left.connectionName.localeCompare(right.connectionName)
  )
}

const routesAreContiguous = (
  left: PreloadedHighDensityRoute,
  right: PreloadedHighDensityRoute,
): boolean => {
  const leftEnd = left.route.at(-1)
  const rightStart = right.route[0]
  return Boolean(
    leftEnd &&
      rightStart &&
      left.preloadedTraceIndex === right.preloadedTraceIndex &&
      pointsAreEqual(leftEnd, rightStart),
  )
}

const interpolateRoutePosition = (
  route: PreloadedHighDensityRoute,
  segmentBoundaryIndex: number,
): number => {
  const start = route.preloadedRoutePositionStart ?? route.preloadedRouteIndex
  const end = route.preloadedRoutePositionEnd ?? route.preloadedRouteIndex
  const segmentCount = route.route.length - 1
  return start + ((end - start) * segmentBoundaryIndex) / segmentCount
}

const segmentIsLayerTransition = (
  route: PreloadedHighDensityRoute,
  segmentIndex: number,
): boolean => route.route[segmentIndex]!.z !== route.route[segmentIndex + 1]!.z

/**
 * Locks only layer transitions at the ends of a maximal contiguous mutation
 * run. A via stored as its own fixed-route primitive remains editable when
 * marked wire primitives connect to both sides of it.
 */
const getMutationMasksWithLockedBoundaries = ({
  updatedFixedRoutes,
  regionalMutationMasks,
}: Pick<
  PreparePipeline9MutationSectionsParams,
  "updatedFixedRoutes" | "regionalMutationMasks"
>): Map<string, boolean[]> => {
  const mutationMasks = new Map<string, boolean[]>()
  for (const sourceRoute of updatedFixedRoutes) {
    if (sourceRoute.route.length === 0) {
      throw new Error(
        `Pipeline9 cannot normalize empty fixed route "${sourceRoute.connectionName}"`,
      )
    }
    const segmentCount = sourceRoute.route.length - 1
    if (mutationMasks.has(sourceRoute.connectionName)) {
      throw new Error(
        `Pipeline9 cannot normalize duplicate fixed route "${sourceRoute.connectionName}"`,
      )
    }
    const sourceMask = regionalMutationMasks.get(sourceRoute.connectionName)
    if (sourceMask && sourceMask.length !== segmentCount) {
      throw new Error(
        `Pipeline9 fixed route mutation mask for "${sourceRoute.connectionName}" has ${sourceMask.length} segments, expected ${segmentCount}`,
      )
    }
    const maySimplify =
      sourceRoute.isThroughObstacle !== true &&
      (sourceRoute.jumpers?.length ?? 0) === 0
    mutationMasks.set(
      sourceRoute.connectionName,
      Array.from(
        { length: segmentCount },
        (_, segmentIndex) =>
          maySimplify && (sourceMask?.[segmentIndex] ?? false),
      ),
    )
  }

  let currentMutationRun: Array<{
    route: PreloadedHighDensityRoute
    segmentIndex: number
  }> = []
  const lockCurrentRunBoundaries = (): void => {
    while (
      currentMutationRun[0] &&
      segmentIsLayerTransition(
        currentMutationRun[0].route,
        currentMutationRun[0].segmentIndex,
      )
    ) {
      const boundary = currentMutationRun.shift()!
      mutationMasks.get(boundary.route.connectionName)![boundary.segmentIndex] =
        false
    }
    while (
      currentMutationRun.at(-1) &&
      segmentIsLayerTransition(
        currentMutationRun.at(-1)!.route,
        currentMutationRun.at(-1)!.segmentIndex,
      )
    ) {
      const boundary = currentMutationRun.pop()!
      mutationMasks.get(boundary.route.connectionName)![boundary.segmentIndex] =
        false
    }
    currentMutationRun = []
  }

  let previousRoute: PreloadedHighDensityRoute | undefined
  for (const route of [...updatedFixedRoutes].sort(compareFixedRoutes)) {
    if (previousRoute && !routesAreContiguous(previousRoute, route)) {
      lockCurrentRunBoundaries()
    }
    const mask = mutationMasks.get(route.connectionName)!
    if (mask.length === 0) {
      lockCurrentRunBoundaries()
      previousRoute = route
      continue
    }
    for (let segmentIndex = 0; segmentIndex < mask.length; segmentIndex++) {
      if (!mask[segmentIndex]) {
        lockCurrentRunBoundaries()
        continue
      }
      currentMutationRun.push({ route, segmentIndex })
    }
    previousRoute = route
  }
  lockCurrentRunBoundaries()
  return mutationMasks
}

/**
 * Splits every fixed route at true/false provenance boundaries. This makes
 * each editable mutation run a first-class route while preserving the exact
 * immutable complement, including gaps between distant mutations on one
 * source route.
 */
const normalizeFixedRoutesByMutationMask = ({
  updatedFixedRoutes,
  regionalMutationMasks,
}: Pick<
  PreparePipeline9MutationSectionsParams,
  "updatedFixedRoutes" | "regionalMutationMasks"
>): NormalizedFixedRoute[] => {
  const normalizedRoutes: NormalizedFixedRoute[] = []
  const mutationMasks = getMutationMasksWithLockedBoundaries({
    updatedFixedRoutes,
    regionalMutationMasks,
  })
  for (const sourceRoute of updatedFixedRoutes) {
    const segmentCount = sourceRoute.route.length - 1
    const mask = mutationMasks.get(sourceRoute.connectionName)!
    if (segmentCount === 0) {
      normalizedRoutes.push({ route: sourceRoute, mutated: false })
      continue
    }
    const runs: Array<{ start: number; end: number; mutated: boolean }> = []
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const mutated = mask[segmentIndex]!
      const previousRun = runs.at(-1)
      if (previousRun?.mutated === mutated) {
        previousRun.end = segmentIndex + 1
      } else {
        runs.push({
          start: segmentIndex,
          end: segmentIndex + 1,
          mutated,
        })
      }
    }
    for (const [runIndex, run] of runs.entries()) {
      const route = sourceRoute.route.slice(run.start, run.end + 1)
      const splitRoute: PreloadedHighDensityRoute = {
        ...sourceRoute,
        connectionName:
          runs.length === 1
            ? sourceRoute.connectionName
            : `${sourceRoute.connectionName}_mutation_fragment_${runIndex}`,
        preloadedRouteIndex:
          sourceRoute.preloadedRouteIndex + runIndex / (runs.length + 1),
        preloadedRoutePositionStart: interpolateRoutePosition(
          sourceRoute,
          run.start,
        ),
        preloadedRoutePositionEnd: interpolateRoutePosition(
          sourceRoute,
          run.end,
        ),
        route,
        vias: getViasFromRoutePoints(route),
      }
      normalizedRoutes.push({ route: splitRoute, mutated: run.mutated })
    }
  }
  return normalizedRoutes
}

const createRegionalMutationSections = (
  normalizedRoutes: NormalizedFixedRoute[],
): FixedRouteSection[] => {
  const sections: FixedRouteSection[] = []
  let currentSection: FixedRouteSection | undefined
  for (const normalizedRoute of [...normalizedRoutes].sort((left, right) =>
    compareFixedRoutes(left.route, right.route),
  )) {
    const route = normalizedRoute.route
    if (!normalizedRoute.mutated) {
      currentSection = undefined
      continue
    }
    const firstPoint = route.route[0]
    const lastPoint = route.route.at(-1)
    if (!firstPoint || !lastPoint || route.route.length < 2) {
      throw new Error(
        `Pipeline9 cannot simplify empty fixed route "${route.connectionName}"`,
      )
    }
    const previousRoute = currentSection?.sourceRoutes.at(-1)
    if (
      currentSection &&
      previousRoute &&
      routesAreContiguous(previousRoute, route)
    ) {
      currentSection.sourceRoutes.push(route)
      currentSection.end = {
        segmentIndex: route.route.length - 2,
        point: lastPoint,
      }
      continue
    }
    currentSection = {
      sourceRoutes: [route],
      start: { segmentIndex: 0, point: firstPoint },
      end: { segmentIndex: route.route.length - 2, point: lastPoint },
    }
    sections.push(currentSection)
  }
  return sections
}

const createEditableHdRoute = (
  section: FixedRouteSection,
  sectionIndex: number,
): HighDensityRoute => {
  const firstSourceRoute = section.sourceRoutes[0]
  const lastSourceRoute = section.sourceRoutes.at(-1)
  if (!firstSourceRoute || !lastSourceRoute) {
    throw new Error("Pipeline9 cannot simplify an empty mutation section")
  }
  const route: RoutePoint[] = [section.start.point]
  for (const [
    sourceRouteIndex,
    sourceRoute,
  ] of section.sourceRoutes.entries()) {
    const isFirstRoute = sourceRouteIndex === 0
    const isLastRoute = sourceRouteIndex === section.sourceRoutes.length - 1
    const sliceStart = isFirstRoute ? section.start.segmentIndex + 1 : 0
    const sliceEnd = isLastRoute
      ? section.end.segmentIndex + 1
      : sourceRoute.route.length
    appendSectionRoutePoints(
      route,
      sourceRoute.route.slice(sliceStart, sliceEnd),
    )
  }
  appendSectionRoutePoints(route, [section.end.point])
  if (route.length < 2) {
    throw new Error(
      `Pipeline9 mutation section for "${firstSourceRoute.connectionName}" has no routable span`,
    )
  }
  return {
    connectionName: `pipeline9_mutated_preload_${firstSourceRoute.preloadedTraceIndex}_${sectionIndex}`,
    rootConnectionName: firstSourceRoute.rootConnectionName,
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

export const preparePipeline9MutatedPreloadedSections = ({
  updatedFixedRoutes,
  regionalMutationMasks,
}: PreparePipeline9MutationSectionsParams): PreparedPipeline9MutationSections => {
  const normalized = normalizeFixedRoutesByMutationMask({
    updatedFixedRoutes,
    regionalMutationMasks,
  })
  const normalizedFixedRoutes = normalized.map(({ route }) => route)
  const mutationSections = createRegionalMutationSections(normalized)
  const sections = mutationSections.map((section, sectionIndex) => {
    const hdRoute = createEditableHdRoute(section, sectionIndex)
    return {
      connectionName: hdRoute.connectionName,
      section,
      hdRoute,
    }
  })
  const editableConnectionNames = new Set(
    sections.flatMap(({ section }) =>
      section.sourceRoutes.map((route) => route.connectionName),
    ),
  )
  return {
    sections,
    immutableHdRoutes: normalizedFixedRoutes.filter(
      (route) => !editableConnectionNames.has(route.connectionName),
    ),
    normalizedFixedRoutes,
  }
}

export const applyPipeline9MutatedPreloadedSections = ({
  updatedFixedRoutes,
  sections,
  simplifiedHdRoutes,
}: ApplyPipeline9MutationSectionsParams): PreloadedHighDensityRoute[] => {
  const expectedConnectionNames = new Set(
    sections.map((section) => section.connectionName),
  )
  const simplifiedRouteByConnectionName = new Map(
    simplifiedHdRoutes.map((route) => [route.connectionName, route]),
  )
  if (
    simplifiedRouteByConnectionName.size !== sections.length ||
    simplifiedHdRoutes.some(
      (route) => !expectedConnectionNames.has(route.connectionName),
    )
  ) {
    throw new Error(
      `Pipeline9 trace simplification changed the mutation-section set (expected ${sections.length}, got ${simplifiedHdRoutes.length})`,
    )
  }
  const replacementBySourceConnectionName = new Map<
    string,
    PreloadedHighDensityRoute
  >()
  const firstSourceConnectionNames = new Set<string>()
  for (const preparedSection of sections) {
    const simplifiedRoute = simplifiedRouteByConnectionName.get(
      preparedSection.connectionName,
    )
    if (!simplifiedRoute) {
      throw new Error(
        `Pipeline9 trace simplification lost mutation section "${preparedSection.connectionName}"`,
      )
    }
    const simplifiedStart = simplifiedRoute.route[0]
    const simplifiedEnd = simplifiedRoute.route.at(-1)
    if (
      !simplifiedStart ||
      !simplifiedEnd ||
      !pointsAreEqual(simplifiedStart, preparedSection.section.start.point) ||
      !pointsAreEqual(simplifiedEnd, preparedSection.section.end.point)
    ) {
      throw new Error(
        `Pipeline9 trace simplification changed mutation-section boundary "${preparedSection.connectionName}"`,
      )
    }
    const replacement = spliceFixedRouteSection(
      preparedSection.section,
      simplifiedRoute,
    )
    const firstSourceRoute = preparedSection.section.sourceRoutes[0]!
    firstSourceConnectionNames.add(firstSourceRoute.connectionName)
    for (const sourceRoute of preparedSection.section.sourceRoutes) {
      if (replacementBySourceConnectionName.has(sourceRoute.connectionName)) {
        throw new Error(
          `Pipeline9 attempted to simplify fixed route "${sourceRoute.connectionName}" more than once`,
        )
      }
      replacementBySourceConnectionName.set(
        sourceRoute.connectionName,
        replacement,
      )
    }
  }
  return updatedFixedRoutes.flatMap((route) => {
    const replacement = replacementBySourceConnectionName.get(
      route.connectionName,
    )
    if (!replacement) return [route]
    return firstSourceConnectionNames.has(route.connectionName)
      ? [replacement]
      : []
  })
}
