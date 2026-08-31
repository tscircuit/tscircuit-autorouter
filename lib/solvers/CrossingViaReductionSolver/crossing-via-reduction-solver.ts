import {
  getSegmentIntersection,
  pointToSegmentDistance,
  segmentToBoxMinDistance,
} from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { doesSegmentCrossPolygonBoundary } from "lib/utils/polygonContainment"
import { BaseSolver } from "../BaseSolver"
import { breakRouteIntoSections } from "../UselessViaRemovalSolver/break-route-into-sections"
import { canSectionMoveToLayer } from "../UselessViaRemovalSolver/can-section-move-to-layer"
import type { RouteSection } from "../UselessViaRemovalSolver/route-section"

export interface CrossingViaReductionSolverInput {
  inputHdRoutes: ReadonlyArray<HighDensityRoute>
  otherHdRoutes?: ReadonlyArray<HighDensityRoute>
  obstacles: ReadonlyArray<Obstacle>
  connMap: ConnectivityMap
  layerCount: number
  outline?: ReadonlyArray<{ x: number; y: number }>
  traceMargin?: number
  obstacleMargin?: number
}

type RoutePoint = HighDensityRoute["route"][number]

type SectionSplit = {
  prefix: RoutePoint[]
  suffix: RoutePoint[]
  point: RoutePoint
}

type TransitionSide = "start" | "end"

type CrossingReductionCandidate = {
  detourRouteIndex: number
  detourRoute: HighDensityRoute
  transitionUpdates: Array<{
    routeIndex: number
    route: HighDensityRoute
    relocatedVias: Array<{ x: number; y: number }>
  }>
}

type IndexedTransitionSegment = {
  routeIndex: number
  sectionIndex: number
  side: TransitionSide
  adjacentZ: number
  start: RoutePoint
  end: RoutePoint
  distanceFromSectionStart: number
}

type IndexedCrossingGroup = {
  transitionRouteIndex: number
  transitionSectionIndex: number
  side: TransitionSide
  crossingDistances: number[]
}

type DetourCandidate = {
  routeIndex: number
  section: RouteSection
  targetZ: number
}

type RouteClearanceIndex = Pick<
  HighDensityRouteSpatialIndex,
  "getConflictingRoutesForSegment" | "getConflictingRoutesNearPoint"
>

type BaseClearanceIndexes = {
  mutableRoutes: HighDensityRouteSpatialIndex
  immutableRoutes: HighDensityRouteSpatialIndex | null
}

const STATIC_GEOMETRY_ONLY_CLEARANCE_INDEX: RouteClearanceIndex = {
  getConflictingRoutesForSegment: () => [],
  getConflictingRoutesNearPoint: () => [],
}

const EPSILON = 1e-6
const DEFAULT_TRACE_MARGIN = 0.1
const DEFAULT_OBSTACLE_MARGIN = 0.15
const MAX_MULTI_CROSSING_SELECTIONS = 4

const getSegmentKey = (start: RoutePoint, end: RoutePoint): string => {
  const startKey = `${start.x}:${start.y}:${start.z}`
  const endKey = `${end.x}:${end.y}:${end.z}`
  return startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`
}

const getRouteSegmentKeys = (route: HighDensityRoute): ReadonlySet<string> => {
  const segmentKeys = new Set<string>()
  for (let index = 1; index < route.route.length; index++) {
    const start = route.route[index - 1]
    const end = route.route[index]
    if (start.z === end.z) {
      segmentKeys.add(getSegmentKey(start, end))
    }
  }
  return segmentKeys
}

const removeConsecutiveDuplicatePoints = (
  points: RoutePoint[],
): RoutePoint[] => {
  return points.filter((point, index) => {
    const previousPoint = points[index - 1]
    return (
      !previousPoint ||
      point.x !== previousPoint.x ||
      point.y !== previousPoint.y ||
      point.z !== previousPoint.z
    )
  })
}

const recomputeVias = (
  route: ReadonlyArray<RoutePoint>,
): HighDensityRoute["vias"] => {
  const vias: HighDensityRoute["vias"] = []
  const seenLocations = new Set<string>()
  for (let index = 1; index < route.length; index++) {
    const previousPoint = route[index - 1]
    const point = route[index]
    if (previousPoint.z === point.z) continue
    if (previousPoint.toNextSegmentType === "through_obstacle") continue
    if (previousPoint.x !== point.x || previousPoint.y !== point.y) {
      throw new Error(
        `CrossingViaReductionSolver found a layer transition without a via at route point ${index}`,
      )
    }

    const key = `${point.x}:${point.y}`
    if (seenLocations.has(key)) continue
    seenLocations.add(key)
    vias.push({ x: point.x, y: point.y })
  }
  return vias
}

type CrossingViaReductionIneligibility =
  | "has-jumpers"
  | "has-non-vertical-layer-transition"

/**
 * Classifies routes outside this optional optimizer's mutation contract. This
 * is an applicability check, not error recovery: jumper geometry and
 * non-vertical layer transitions are owned by other routing primitives, while
 * this solver only rebuilds ordinary vertical vias and explicit
 * through-obstacle transitions. recomputeVias still throws if an eligible
 * route violates that contract during mutation.
 */
const getCrossingViaReductionIneligibility = (
  route: HighDensityRoute,
): CrossingViaReductionIneligibility | null => {
  if (route.jumpers?.length) return "has-jumpers"
  for (let index = 1; index < route.route.length; index++) {
    const previousPoint = route.route[index - 1]
    const point = route.route[index]
    if (previousPoint.z === point.z) continue
    if (previousPoint.toNextSegmentType === "through_obstacle") continue
    if (previousPoint.x !== point.x || previousPoint.y !== point.y) {
      return "has-non-vertical-layer-transition"
    }
  }
  return null
}

const getRouteIds = (route: HighDensityRoute): string[] => {
  const routeIds = [route.connectionName]
  if (route.rootConnectionName) {
    routeIds.push(route.rootConnectionName)
  }
  return routeIds
}

const routesAreSameNet = (
  firstRoute: HighDensityRoute,
  secondRoute: HighDensityRoute,
  connMap: ConnectivityMap,
): boolean => {
  const firstRouteIds = getRouteIds(firstRoute)
  const secondRouteIds = getRouteIds(secondRoute)
  return firstRouteIds.some((firstId) =>
    secondRouteIds.some(
      (secondId) =>
        firstId === secondId || connMap.areIdsConnected(firstId, secondId),
    ),
  )
}

const obstacleIsSameNet = (
  obstacle: Obstacle,
  route: HighDensityRoute,
  connMap: ConnectivityMap,
): boolean => {
  const routeIds = getRouteIds(route)
  return obstacle.connectedTo.some((connectedId) =>
    routeIds.some(
      (routeId) =>
        connectedId === routeId ||
        connMap.areIdsConnected(connectedId, routeId),
    ),
  )
}

const getSectionLength = (points: ReadonlyArray<RoutePoint>): number => {
  let length = 0
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    )
  }
  return length
}

const splitSectionAtDistance = (
  points: ReadonlyArray<RoutePoint>,
  distanceFromStart: number,
): SectionSplit | null => {
  const sectionLength = getSectionLength(points)
  if (
    distanceFromStart <= EPSILON ||
    distanceFromStart >= sectionLength - EPSILON
  ) {
    return null
  }

  let traversedDistance = 0
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]
    const end = points[index]
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y)
    if (traversedDistance + segmentLength < distanceFromStart - EPSILON) {
      traversedDistance += segmentLength
      continue
    }

    const distanceOnSegment = distanceFromStart - traversedDistance
    if (distanceOnSegment <= EPSILON) {
      return {
        prefix: points.slice(0, index).map((point) => ({ ...point })),
        suffix: points.slice(index - 1).map((point) => ({ ...point })),
        point: { ...start },
      }
    }
    if (segmentLength - distanceOnSegment <= EPSILON) {
      return {
        prefix: points.slice(0, index + 1).map((point) => ({ ...point })),
        suffix: points.slice(index).map((point) => ({ ...point })),
        point: { ...end },
      }
    }

    const ratio = distanceOnSegment / segmentLength
    const point: RoutePoint = {
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
      z: start.z,
    }
    return {
      prefix: [...points.slice(0, index), point].map((item) => ({ ...item })),
      suffix: [point, ...points.slice(index)].map((item) => ({ ...item })),
      point,
    }
  }
  return null
}

const getInteriorIntersectionDistance = (
  transitionStart: RoutePoint,
  transitionEnd: RoutePoint,
  detourStart: RoutePoint,
  detourEnd: RoutePoint,
): number | null => {
  const intersection = getSegmentIntersection(
    transitionStart,
    transitionEnd,
    detourStart,
    detourEnd,
  )
  if (!intersection) return null

  const distanceFromTransitionStart = Math.hypot(
    intersection.x - transitionStart.x,
    intersection.y - transitionStart.y,
  )
  const distanceFromTransitionEnd = Math.hypot(
    intersection.x - transitionEnd.x,
    intersection.y - transitionEnd.y,
  )
  const distanceFromDetourStart = Math.hypot(
    intersection.x - detourStart.x,
    intersection.y - detourStart.y,
  )
  const distanceFromDetourEnd = Math.hypot(
    intersection.x - detourEnd.x,
    intersection.y - detourEnd.y,
  )
  if (
    Math.min(
      distanceFromTransitionStart,
      distanceFromTransitionEnd,
      distanceFromDetourStart,
      distanceFromDetourEnd,
    ) <= EPSILON
  ) {
    return null
  }

  return distanceFromTransitionStart
}

const sectionHasProtectedGeometry = (section: RouteSection): boolean => {
  return section.points.some(
    (point) => point.insideJumperPad || point.toNextSegmentType,
  )
}

const getTransitionAdjacentZ = ({
  sections,
  sectionIndex,
  side,
}: {
  sections: RouteSection[]
  sectionIndex: number
  side: TransitionSide
}): number | null => {
  const section = sections[sectionIndex]
  const adjacentSection =
    side === "start" ? sections[sectionIndex - 1] : sections[sectionIndex + 1]
  if (!adjacentSection) return null

  const sectionPoint =
    side === "start" ? section.points[0] : section.points.at(-1)!
  const adjacentPoint =
    side === "start"
      ? adjacentSection.points.at(-1)!
      : adjacentSection.points[0]
  if (
    sectionPoint.x !== adjacentPoint.x ||
    sectionPoint.y !== adjacentPoint.y
  ) {
    return null
  }
  return adjacentSection.z
}

const hasTransitionOnSide = ({
  sections,
  sectionIndex,
  targetZ,
  side,
}: {
  sections: RouteSection[]
  sectionIndex: number
  targetZ: number
  side: TransitionSide
}): boolean => {
  return getTransitionAdjacentZ({ sections, sectionIndex, side }) === targetZ
}

const createCandidateClearanceIndex = ({
  baseIndexes,
  otherCandidateRoutes,
  ignoredConnectionNames,
  originalRouteSegmentKeys,
}: {
  baseIndexes: BaseClearanceIndexes
  otherCandidateRoutes: ReadonlyArray<HighDensityRoute>
  ignoredConnectionNames: ReadonlySet<string>
  originalRouteSegmentKeys: ReadonlySet<string>
}): RouteClearanceIndex => {
  const candidatePairIndex = new HighDensityRouteSpatialIndex([
    ...otherCandidateRoutes,
  ])
  return {
    getConflictingRoutesForSegment: (start, end, margin) => {
      const segmentWasUnchanged = originalRouteSegmentKeys.has(
        getSegmentKey(start, end),
      )
      return [
        ...(segmentWasUnchanged
          ? []
          : baseIndexes.mutableRoutes
              .getConflictingRoutesForSegment(start, end, margin)
              .filter(
                ({ conflictingRoute }) =>
                  !ignoredConnectionNames.has(conflictingRoute.connectionName),
              )),
        ...(segmentWasUnchanged
          ? []
          : (baseIndexes.immutableRoutes?.getConflictingRoutesForSegment(
              start,
              end,
              margin,
            ) ?? [])),
        ...candidatePairIndex.getConflictingRoutesForSegment(
          start,
          end,
          margin,
        ),
      ]
    },
    getConflictingRoutesNearPoint: (point, margin) => [
      ...baseIndexes.mutableRoutes
        .getConflictingRoutesNearPoint(point, margin)
        .filter(
          ({ conflictingRoute }) =>
            !ignoredConnectionNames.has(conflictingRoute.connectionName),
        ),
      ...(baseIndexes.immutableRoutes?.getConflictingRoutesNearPoint(
        point,
        margin,
      ) ?? []),
      ...candidatePairIndex.getConflictingRoutesNearPoint(point, margin),
    ],
  }
}

/**
 * Removes the two-via layer detour in an A-B-A route when it crosses an
 * A-layer sections whose existing vias are adjacent to the crossings. The
 * change is atomic: the detour moves to A while each adjacent via moves past
 * its crossing and extends B through it. Every candidate route set is
 * clearance-checked before any route is changed.
 */
export class CrossingViaReductionSolver extends BaseSolver {
  private readonly input: CrossingViaReductionSolverInput
  private readonly obstacleSHI: ObstacleSpatialHashIndex
  private readonly traceMargin: number
  private readonly obstacleMargin: number

  reducedHdRoutes: HighDensityRoute[]

  override getSolverName(): string {
    return "CrossingViaReductionSolver"
  }

  constructor(input: CrossingViaReductionSolverInput) {
    super()
    this.input = {
      ...input,
      obstacles: createObjectsWithZLayers(input.obstacles, input.layerCount),
    }
    this.traceMargin = input.traceMargin ?? DEFAULT_TRACE_MARGIN
    this.obstacleMargin = input.obstacleMargin ?? DEFAULT_OBSTACLE_MARGIN
    this.reducedHdRoutes = structuredClone([...input.inputHdRoutes])
    this.obstacleSHI = new ObstacleSpatialHashIndex("flatbush", [
      ...this.input.obstacles,
    ])
    this.MAX_ITERATIONS = 1e6
  }

  private collapseDetourSection({
    route,
    section,
    targetZ,
  }: {
    route: HighDensityRoute
    section: RouteSection
    targetZ: number
  }): HighDensityRoute {
    const collapsedPoints = section.points.map((point) => ({
      ...point,
      z: targetZ,
    }))
    const routePoints = removeConsecutiveDuplicatePoints([
      ...route.route
        .slice(0, section.startIndex)
        .map((point) => ({ ...point })),
      ...collapsedPoints,
      ...route.route.slice(section.endIndex + 1).map((point) => ({ ...point })),
    ])
    return {
      ...route,
      route: routePoints,
      vias: recomputeVias(routePoints),
    }
  }

  private relocateTransitionVia({
    route,
    section,
    targetZ,
    side,
    newViaDistance,
  }: {
    route: HighDensityRoute
    section: RouteSection
    targetZ: number
    side: TransitionSide
    newViaDistance: number
  }): {
    route: HighDensityRoute
    relocatedVia: { x: number; y: number }
  } | null {
    const split = splitSectionAtDistance(section.points, newViaDistance)
    if (!split) return null

    const prefixZ = side === "start" ? targetZ : section.z
    const suffixZ = side === "start" ? section.z : targetZ
    const replacementPoints = [
      ...split.prefix.map((point) => ({ ...point, z: prefixZ })),
      ...split.suffix.map((point) => ({ ...point, z: suffixZ })),
    ]
    const routePoints = removeConsecutiveDuplicatePoints([
      ...route.route
        .slice(0, section.startIndex)
        .map((point) => ({ ...point })),
      ...replacementPoints,
      ...route.route.slice(section.endIndex + 1).map((point) => ({ ...point })),
    ])
    return {
      route: {
        ...route,
        route: routePoints,
        vias: recomputeVias(routePoints),
      },
      relocatedVia: { x: split.point.x, y: split.point.y },
    }
  }

  private relocateTransitionVias({
    route,
    sections,
    crossingGroups,
    detourZ,
    detourTraceThickness,
  }: {
    route: HighDensityRoute
    sections: RouteSection[]
    crossingGroups: IndexedCrossingGroup[]
    detourZ: number
    detourTraceThickness: number
  }): {
    route: HighDensityRoute
    relocatedVias: Array<{ x: number; y: number }>
  } | null {
    const groupsBySection = new Map<number, IndexedCrossingGroup[]>()
    for (const crossingGroup of crossingGroups) {
      const groups =
        groupsBySection.get(crossingGroup.transitionSectionIndex) ?? []
      groups.push(crossingGroup)
      groupsBySection.set(crossingGroup.transitionSectionIndex, groups)
    }

    const replacements: Array<{
      section: RouteSection
      points: RoutePoint[]
    }> = []
    const relocatedVias: Array<{ x: number; y: number }> = []
    const viaClearance =
      route.viaDiameter / 2 +
      detourTraceThickness / 2 +
      this.traceMargin +
      EPSILON

    for (const [sectionIndex, sectionGroups] of groupsBySection) {
      if (sectionGroups.length !== 1) return null
      const section = sections[sectionIndex]
      const crossingGroup = sectionGroups[0]
      if (
        !hasTransitionOnSide({
          sections,
          sectionIndex,
          targetZ: detourZ,
          side: crossingGroup.side,
        })
      ) {
        return null
      }
      const newViaDistance =
        crossingGroup.side === "start"
          ? Math.max(...crossingGroup.crossingDistances) + viaClearance
          : Math.min(...crossingGroup.crossingDistances) - viaClearance
      const split = splitSectionAtDistance(section.points, newViaDistance)
      if (!split) return null
      const prefixZ = crossingGroup.side === "start" ? detourZ : section.z
      const suffixZ = crossingGroup.side === "start" ? section.z : detourZ
      replacements.push({
        section,
        points: [
          ...split.prefix.map((point) => ({ ...point, z: prefixZ })),
          ...split.suffix.map((point) => ({ ...point, z: suffixZ })),
        ],
      })
      relocatedVias.push({ x: split.point.x, y: split.point.y })
    }

    let routePoints = route.route.map((point) => ({ ...point }))
    for (const replacement of replacements.sort(
      (first, second) => second.section.startIndex - first.section.startIndex,
    )) {
      routePoints = [
        ...routePoints.slice(0, replacement.section.startIndex),
        ...replacement.points,
        ...routePoints.slice(replacement.section.endIndex + 1),
      ]
    }
    routePoints = removeConsecutiveDuplicatePoints(routePoints)
    return {
      route: {
        ...route,
        route: routePoints,
        vias: recomputeVias(routePoints),
      },
      relocatedVias,
    }
  }

  private routeIsClear(
    route: HighDensityRoute,
    hdRouteSHI: RouteClearanceIndex,
    originalRouteSegmentKeys: ReadonlySet<string>,
  ): boolean {
    for (const section of breakRouteIntoSections(route)) {
      for (let index = 1; index < section.points.length; index++) {
        const start = section.points[index - 1]
        const end = section.points[index]
        if (
          !originalRouteSegmentKeys.has(getSegmentKey(start, end)) &&
          this.input.outline &&
          doesSegmentCrossPolygonBoundary({
            start,
            end,
            polygon: [...this.input.outline],
            margin: route.traceThickness / 2,
          })
        ) {
          return false
        }
      }

      if (
        !canSectionMoveToLayer({
          currentSection: section,
          targetZ: section.z,
          route,
          hdRouteSHI,
          obstacleSHI: this.obstacleSHI,
          connMap: this.input.connMap,
          defaultTraceThickness: route.traceThickness,
          obstacleMargin: this.obstacleMargin,
          traceMargin: this.traceMargin,
          shouldCheckStaticGeometryForSegment: (start, end) =>
            !originalRouteSegmentKeys.has(getSegmentKey(start, end)),
        })
      ) {
        return false
      }
    }
    return true
  }

  private relocatedViaIsClear(
    route: HighDensityRoute,
    relocatedVia: { x: number; y: number },
    hdRouteSHI: RouteClearanceIndex,
  ): boolean {
    const viaRadius = route.viaDiameter / 2
    for (let z = 0; z < this.input.layerCount; z++) {
      const conflicts = hdRouteSHI.getConflictingRoutesNearPoint(
        { ...relocatedVia, z },
        viaRadius + this.traceMargin,
      )
      if (
        conflicts.some(
          ({ conflictingRoute }) =>
            !routesAreSameNet(route, conflictingRoute, this.input.connMap),
        )
      ) {
        return false
      }
    }

    const obstacleSearchMargin = viaRadius + this.obstacleMargin
    const nearbyObstacles = this.obstacleSHI.searchArea(
      relocatedVia.x,
      relocatedVia.y,
      obstacleSearchMargin * 2,
      obstacleSearchMargin * 2,
    )
    for (const obstacle of nearbyObstacles) {
      if (obstacleIsSameNet(obstacle, route, this.input.connMap)) continue
      if (
        segmentToBoxMinDistance(relocatedVia, relocatedVia, obstacle) <
        obstacleSearchMargin
      ) {
        return false
      }
    }

    if (this.input.outline) {
      for (let index = 0; index < this.input.outline.length; index++) {
        const edgeStart = this.input.outline[index]
        const edgeEnd =
          this.input.outline[(index + 1) % this.input.outline.length]
        if (
          pointToSegmentDistance(relocatedVia, edgeStart, edgeEnd) <
          viaRadius + this.traceMargin
        ) {
          return false
        }
      }
    }
    return true
  }

  /**
   * Removing the detour vias can merge changed and unchanged copper into one
   * layer section. Recheck that merged section at the relaxed DRC clearance,
   * while leaving unrelated sections on the delta-only fast path.
   */
  private changedSectionsAreStaticallyClear(
    route: HighDensityRoute,
    originalRouteSegmentKeys: ReadonlySet<string>,
  ): boolean {
    for (const section of breakRouteIntoSections(route)) {
      const containsChangedSegment = section.points.some((point, index) => {
        const previousPoint = section.points[index - 1]
        return (
          previousPoint !== undefined &&
          !originalRouteSegmentKeys.has(getSegmentKey(previousPoint, point))
        )
      })
      if (!containsChangedSegment) continue

      if (this.input.outline) {
        for (let index = 1; index < section.points.length; index++) {
          if (
            doesSegmentCrossPolygonBoundary({
              start: section.points[index - 1],
              end: section.points[index],
              polygon: [...this.input.outline],
              margin: route.traceThickness / 2,
            })
          ) {
            return false
          }
        }
      }

      if (
        !canSectionMoveToLayer({
          currentSection: section,
          targetZ: section.z,
          route,
          hdRouteSHI: STATIC_GEOMETRY_ONLY_CLEARANCE_INDEX,
          obstacleSHI: this.obstacleSHI,
          connMap: this.input.connMap,
          defaultTraceThickness: route.traceThickness,
          obstacleMargin: Math.min(this.obstacleMargin, 0.1),
          traceMargin: this.traceMargin,
        })
      ) {
        return false
      }
    }
    return true
  }

  private candidateIsClear(
    candidate: CrossingReductionCandidate,
    baseIndexes: BaseClearanceIndexes,
  ): boolean {
    const candidateRoutes = [
      {
        routeIndex: candidate.detourRouteIndex,
        route: candidate.detourRoute,
      },
      ...candidate.transitionUpdates,
    ]
    const ignoredConnectionNames = new Set(
      candidateRoutes.map(
        ({ routeIndex }) => this.reducedHdRoutes[routeIndex].connectionName,
      ),
    )
    const originalDetourRouteSegmentKeys = getRouteSegmentKeys(
      this.reducedHdRoutes[candidate.detourRouteIndex],
    )
    const detourObstacleIndex = createCandidateClearanceIndex({
      baseIndexes,
      otherCandidateRoutes: candidate.transitionUpdates.map(
        ({ route }) => route,
      ),
      ignoredConnectionNames,
      originalRouteSegmentKeys: originalDetourRouteSegmentKeys,
    })
    this.stats.candidateClearanceChecks =
      (this.stats.candidateClearanceChecks ?? 0) + 1
    if (
      !this.routeIsClear(
        candidate.detourRoute,
        detourObstacleIndex,
        originalDetourRouteSegmentKeys,
      )
    ) {
      return false
    }

    for (const transitionUpdate of candidate.transitionUpdates) {
      const originalSegmentKeys = getRouteSegmentKeys(
        this.reducedHdRoutes[transitionUpdate.routeIndex],
      )
      const transitionObstacleIndex = createCandidateClearanceIndex({
        baseIndexes,
        otherCandidateRoutes: candidateRoutes
          .filter(
            ({ routeIndex }) => routeIndex !== transitionUpdate.routeIndex,
          )
          .map(({ route }) => route),
        ignoredConnectionNames,
        originalRouteSegmentKeys: originalSegmentKeys,
      })
      if (
        !this.routeIsClear(
          transitionUpdate.route,
          transitionObstacleIndex,
          originalSegmentKeys,
        ) ||
        transitionUpdate.relocatedVias.some(
          (relocatedVia) =>
            !this.relocatedViaIsClear(
              transitionUpdate.route,
              relocatedVia,
              transitionObstacleIndex,
            ),
        )
      ) {
        return false
      }
    }

    return this.changedSectionsAreStaticallyClear(
      candidate.detourRoute,
      originalDetourRouteSegmentKeys,
    )
  }

  /**
   * Multi-route changes feed another path-simplification pass. Avoid using a
   * route that already has unresolved copper conflicts as one of its inputs:
   * reshaping that route downstream can turn a pre-existing intermediate
   * conflict into a final DRC regression far from the relocated via.
   *
   * This runs only after a multi-crossing candidate passes its delta checks,
   * so the common rejected-candidate path stays fast.
   */
  private candidateRoutesHaveNoExternalCopperConflicts(
    candidate: CrossingReductionCandidate,
    baseIndexes: BaseClearanceIndexes,
  ): boolean {
    const candidateRoutes = [
      candidate.detourRoute,
      ...candidate.transitionUpdates.map(({ route }) => route),
    ]
    const candidateConnectionNames = new Set(
      candidateRoutes.map(({ connectionName }) => connectionName),
    )
    const routeIndexes = [
      baseIndexes.mutableRoutes,
      ...(baseIndexes.immutableRoutes ? [baseIndexes.immutableRoutes] : []),
    ]

    for (const route of candidateRoutes) {
      for (const section of breakRouteIntoSections(route)) {
        for (let index = 1; index < section.points.length; index++) {
          const start = section.points[index - 1]
          const end = section.points[index]
          for (const routeIndex of routeIndexes) {
            const hasExternalConflict = routeIndex
              .getConflictingRoutesForSegment(
                start,
                end,
                route.traceThickness / 2 + this.traceMargin,
              )
              .some(
                ({ conflictingRoute }) =>
                  !candidateConnectionNames.has(
                    conflictingRoute.connectionName,
                  ) &&
                  !routesAreSameNet(
                    route,
                    conflictingRoute,
                    this.input.connMap,
                  ),
              )
            if (hasExternalConflict) return false
          }
        }
      }
    }
    return true
  }

  private buildTransitionSegmentIndex(
    sectionsByRoute: RouteSection[][],
    relevantLayerTransitions: ReadonlySet<string>,
  ): FlatbushIndex<IndexedTransitionSegment> | null {
    const indexedSegments: IndexedTransitionSegment[] = []
    for (
      let routeIndex = 0;
      routeIndex < this.reducedHdRoutes.length;
      routeIndex++
    ) {
      if (
        getCrossingViaReductionIneligibility(
          this.reducedHdRoutes[routeIndex],
        ) !== null
      ) {
        continue
      }
      const sections = sectionsByRoute[routeIndex]
      for (
        let sectionIndex = 0;
        sectionIndex < sections.length;
        sectionIndex++
      ) {
        const section = sections[sectionIndex]
        if (sectionHasProtectedGeometry(section)) continue

        for (const side of ["start", "end"] as const) {
          const adjacentZ = getTransitionAdjacentZ({
            sections,
            sectionIndex,
            side,
          })
          if (adjacentZ === null || adjacentZ === section.z) continue
          if (!relevantLayerTransitions.has(`${section.z}:${adjacentZ}`)) {
            continue
          }

          let distanceFromSectionStart = 0
          for (
            let segmentIndex = 1;
            segmentIndex < section.points.length;
            segmentIndex++
          ) {
            const start = section.points[segmentIndex - 1]
            const end = section.points[segmentIndex]
            const segmentLength = Math.hypot(end.x - start.x, end.y - start.y)
            if (segmentLength > EPSILON) {
              indexedSegments.push({
                routeIndex,
                sectionIndex,
                side,
                adjacentZ,
                start,
                end,
                distanceFromSectionStart,
              })
            }
            distanceFromSectionStart += segmentLength
          }
        }
      }
    }

    this.stats.transitionSegmentsIndexed =
      (this.stats.transitionSegmentsIndexed ?? 0) + indexedSegments.length
    if (indexedSegments.length === 0) return null

    const index = new FlatbushIndex<IndexedTransitionSegment>(
      indexedSegments.length,
    )
    for (const segment of indexedSegments) {
      index.insert(
        segment,
        Math.min(segment.start.x, segment.end.x),
        Math.min(segment.start.y, segment.end.y),
        Math.max(segment.start.x, segment.end.x),
        Math.max(segment.start.y, segment.end.y),
      )
    }
    index.finish()
    return index
  }

  private getIndexedCrossingGroups({
    detourRouteIndex,
    detourSection,
    targetZ,
    transitionSegmentIndex,
  }: {
    detourRouteIndex: number
    detourSection: RouteSection
    targetZ: number
    transitionSegmentIndex: FlatbushIndex<IndexedTransitionSegment>
  }): IndexedCrossingGroup[] {
    const groups = new Map<string, IndexedCrossingGroup>()
    for (
      let detourSegmentIndex = 1;
      detourSegmentIndex < detourSection.points.length;
      detourSegmentIndex++
    ) {
      const detourStart = detourSection.points[detourSegmentIndex - 1]
      const detourEnd = detourSection.points[detourSegmentIndex]
      if (
        Math.hypot(detourEnd.x - detourStart.x, detourEnd.y - detourStart.y) <=
        EPSILON
      ) {
        continue
      }

      this.stats.indexedDetourSegmentQueries =
        (this.stats.indexedDetourSegmentQueries ?? 0) + 1
      const nearbySegments = transitionSegmentIndex.search(
        Math.min(detourStart.x, detourEnd.x) - EPSILON,
        Math.min(detourStart.y, detourEnd.y) - EPSILON,
        Math.max(detourStart.x, detourEnd.x) + EPSILON,
        Math.max(detourStart.y, detourEnd.y) + EPSILON,
      )
      for (const transitionSegment of nearbySegments) {
        if (
          transitionSegment.routeIndex === detourRouteIndex ||
          transitionSegment.start.z !== targetZ ||
          transitionSegment.adjacentZ !== detourSection.z
        ) {
          continue
        }

        this.stats.exactSegmentIntersectionChecks =
          (this.stats.exactSegmentIntersectionChecks ?? 0) + 1
        const distanceOnTransitionSegment = getInteriorIntersectionDistance(
          transitionSegment.start,
          transitionSegment.end,
          detourStart,
          detourEnd,
        )
        if (distanceOnTransitionSegment === null) continue

        const key = `${transitionSegment.routeIndex}:${transitionSegment.sectionIndex}:${transitionSegment.side}`
        let group = groups.get(key)
        if (!group) {
          group = {
            transitionRouteIndex: transitionSegment.routeIndex,
            transitionSectionIndex: transitionSegment.sectionIndex,
            side: transitionSegment.side,
            crossingDistances: [],
          }
          groups.set(key, group)
        }
        group.crossingDistances.push(
          transitionSegment.distanceFromSectionStart +
            distanceOnTransitionSegment,
        )
      }
    }

    return [...groups.values()].sort((first, second) => {
      if (first.transitionRouteIndex !== second.transitionRouteIndex) {
        return first.transitionRouteIndex - second.transitionRouteIndex
      }
      if (first.transitionSectionIndex !== second.transitionSectionIndex) {
        return first.transitionSectionIndex - second.transitionSectionIndex
      }
      if (first.side === second.side) return 0
      return first.side === "start" ? -1 : 1
    })
  }

  private tryCreateCandidate({
    detourRouteIndex,
    detourSection,
    targetZ,
    transitionRouteIndex,
    transitionSection,
    transitionSections,
    transitionSectionIndex,
    side,
    crossingDistances,
    baseClearanceIndexes,
  }: {
    detourRouteIndex: number
    detourSection: RouteSection
    targetZ: number
    transitionRouteIndex: number
    transitionSection: RouteSection
    transitionSections: RouteSection[]
    transitionSectionIndex: number
    side: TransitionSide
    crossingDistances: number[]
    baseClearanceIndexes: BaseClearanceIndexes
  }): CrossingReductionCandidate | null {
    if (
      !hasTransitionOnSide({
        sections: transitionSections,
        sectionIndex: transitionSectionIndex,
        targetZ: detourSection.z,
        side,
      })
    ) {
      return null
    }

    const detourRoute = this.reducedHdRoutes[detourRouteIndex]
    const transitionRoute = this.reducedHdRoutes[transitionRouteIndex]
    if (crossingDistances.length === 0) return null

    const viaClearance =
      transitionRoute.viaDiameter / 2 +
      detourRoute.traceThickness / 2 +
      this.traceMargin +
      EPSILON
    const newViaDistance =
      side === "start"
        ? Math.max(...crossingDistances) + viaClearance
        : Math.min(...crossingDistances) - viaClearance
    const relocatedTransition = this.relocateTransitionVia({
      route: transitionRoute,
      section: transitionSection,
      targetZ: detourSection.z,
      side,
      newViaDistance,
    })
    if (!relocatedTransition) return null

    const collapsedDetour = this.collapseDetourSection({
      route: detourRoute,
      section: detourSection,
      targetZ,
    })
    const viasRemoved =
      detourRoute.vias.length +
      transitionRoute.vias.length -
      collapsedDetour.vias.length -
      relocatedTransition.route.vias.length
    if (viasRemoved !== 2) return null

    const candidate: CrossingReductionCandidate = {
      detourRouteIndex,
      detourRoute: collapsedDetour,
      transitionUpdates: [
        {
          routeIndex: transitionRouteIndex,
          route: relocatedTransition.route,
          relocatedVias: [relocatedTransition.relocatedVia],
        },
      ],
    }
    return this.candidateIsClear(candidate, baseClearanceIndexes)
      ? candidate
      : null
  }

  private tryCreateMultiCrossingCandidate({
    detourRouteIndex,
    detourSection,
    targetZ,
    crossingGroups,
    sectionsByRoute,
    baseClearanceIndexes,
  }: {
    detourRouteIndex: number
    detourSection: RouteSection
    targetZ: number
    crossingGroups: IndexedCrossingGroup[]
    sectionsByRoute: RouteSection[][]
    baseClearanceIndexes: BaseClearanceIndexes
  }): CrossingReductionCandidate | null {
    if (crossingGroups.length < 2) return null
    const detourRoute = this.reducedHdRoutes[detourRouteIndex]
    const transitionUpdates: CrossingReductionCandidate["transitionUpdates"] =
      []
    const groupsByRoute = new Map<number, IndexedCrossingGroup[]>()
    for (const crossingGroup of crossingGroups) {
      const routeGroups =
        groupsByRoute.get(crossingGroup.transitionRouteIndex) ?? []
      routeGroups.push(crossingGroup)
      groupsByRoute.set(crossingGroup.transitionRouteIndex, routeGroups)
    }
    for (const [routeIndex, routeGroups] of groupsByRoute) {
      const transitionRoute = this.reducedHdRoutes[routeIndex]
      const relocatedTransition = this.relocateTransitionVias({
        route: transitionRoute,
        sections: sectionsByRoute[routeIndex],
        crossingGroups: routeGroups,
        detourZ: detourSection.z,
        detourTraceThickness: detourRoute.traceThickness,
      })
      if (!relocatedTransition) return null
      transitionUpdates.push({
        routeIndex,
        route: relocatedTransition.route,
        relocatedVias: relocatedTransition.relocatedVias,
      })
    }

    const collapsedDetour = this.collapseDetourSection({
      route: detourRoute,
      section: detourSection,
      targetZ,
    })
    const originalViaCount =
      detourRoute.vias.length +
      [...groupsByRoute.keys()].reduce(
        (sum, transitionRouteIndex) =>
          sum + this.reducedHdRoutes[transitionRouteIndex].vias.length,
        0,
      )
    const candidateViaCount =
      collapsedDetour.vias.length +
      transitionUpdates.reduce((sum, { route }) => sum + route.vias.length, 0)
    if (originalViaCount - candidateViaCount !== 2) return null

    this.stats.multiCrossingCandidates =
      (this.stats.multiCrossingCandidates ?? 0) + 1
    const candidate: CrossingReductionCandidate = {
      detourRouteIndex,
      detourRoute: collapsedDetour,
      transitionUpdates,
    }
    if (!this.candidateIsClear(candidate, baseClearanceIndexes)) return null
    if (
      !this.candidateRoutesHaveNoExternalCopperConflicts(
        candidate,
        baseClearanceIndexes,
      )
    ) {
      this.stats.multiCrossingPreexistingConflictRejections =
        (this.stats.multiCrossingPreexistingConflictRejections ?? 0) + 1
      return null
    }
    this.stats.multiCrossingReductions =
      (this.stats.multiCrossingReductions ?? 0) + 1
    this.stats.transitionRoutesMovedByMultiCrossingReductions =
      (this.stats.transitionRoutesMovedByMultiCrossingReductions ?? 0) +
      transitionUpdates.length
    return candidate
  }

  private findCrossingReduction(): CrossingReductionCandidate | null {
    const sectionsByRoute = this.reducedHdRoutes.map((route) =>
      breakRouteIntoSections(route),
    )
    const detourCandidates: DetourCandidate[] = []
    const relevantLayerTransitions = new Set<string>()
    for (
      let detourRouteIndex = 0;
      detourRouteIndex < this.reducedHdRoutes.length;
      detourRouteIndex++
    ) {
      const ineligibility = getCrossingViaReductionIneligibility(
        this.reducedHdRoutes[detourRouteIndex],
      )
      if (ineligibility === "has-jumpers") continue
      if (ineligibility === "has-non-vertical-layer-transition") {
        this.stats.routesSkippedForNonVerticalLayerTransitions =
          (this.stats.routesSkippedForNonVerticalLayerTransitions ?? 0) + 1
        continue
      }
      const detourSections = sectionsByRoute[detourRouteIndex]
      for (
        let detourSectionIndex = 1;
        detourSectionIndex < detourSections.length - 1;
        detourSectionIndex++
      ) {
        const previousSection = detourSections[detourSectionIndex - 1]
        const detourSection = detourSections[detourSectionIndex]
        const nextSection = detourSections[detourSectionIndex + 1]
        if (
          previousSection.z !== nextSection.z ||
          previousSection.z === detourSection.z ||
          sectionHasProtectedGeometry(detourSection)
        ) {
          continue
        }
        detourCandidates.push({
          routeIndex: detourRouteIndex,
          section: detourSection,
          targetZ: previousSection.z,
        })
        relevantLayerTransitions.add(`${previousSection.z}:${detourSection.z}`)
      }
    }
    if (detourCandidates.length === 0) return null

    const transitionSegmentIndex = this.buildTransitionSegmentIndex(
      sectionsByRoute,
      relevantLayerTransitions,
    )
    if (!transitionSegmentIndex) return null
    let baseClearanceIndexes: BaseClearanceIndexes | null = null

    for (const detourCandidate of detourCandidates) {
      const detourRouteIndex = detourCandidate.routeIndex
      const detourSection = detourCandidate.section
      const detourRoute = this.reducedHdRoutes[detourRouteIndex]
      const crossingGroups = this.getIndexedCrossingGroups({
        detourRouteIndex,
        detourSection,
        targetZ: detourCandidate.targetZ,
        transitionSegmentIndex,
      })
      const actionableCrossingGroups = crossingGroups.filter(
        ({ transitionRouteIndex }) => {
          const transitionRoute = this.reducedHdRoutes[transitionRouteIndex]
          return (
            !transitionRoute.jumpers?.length &&
            !routesAreSameNet(detourRoute, transitionRoute, this.input.connMap)
          )
        },
      )
      const crossingGroupOptions = new Map<string, IndexedCrossingGroup[]>()
      for (const crossingGroup of actionableCrossingGroups) {
        const key = `${crossingGroup.transitionRouteIndex}:${crossingGroup.transitionSectionIndex}`
        const options = crossingGroupOptions.get(key) ?? []
        options.push(crossingGroup)
        crossingGroupOptions.set(key, options)
      }
      if (crossingGroupOptions.size > 1) {
        baseClearanceIndexes ??= {
          mutableRoutes: new HighDensityRouteSpatialIndex(this.reducedHdRoutes),
          immutableRoutes: this.input.otherHdRoutes?.length
            ? new HighDensityRouteSpatialIndex([...this.input.otherHdRoutes])
            : null,
        }
        let selections: Array<{
          groups: IndexedCrossingGroup[]
          movement: number
        }> = [{ groups: [], movement: 0 }]
        const getMovementDistance = (group: IndexedCrossingGroup) => {
          const route = this.reducedHdRoutes[group.transitionRouteIndex]
          const section =
            sectionsByRoute[group.transitionRouteIndex][
              group.transitionSectionIndex
            ]
          const viaClearance =
            route.viaDiameter / 2 +
            detourRoute.traceThickness / 2 +
            this.traceMargin +
            EPSILON
          const newViaDistance =
            group.side === "start"
              ? Math.max(...group.crossingDistances) + viaClearance
              : Math.min(...group.crossingDistances) - viaClearance
          return group.side === "start"
            ? newViaDistance
            : getSectionLength(section.points) - newViaDistance
        }
        for (const options of crossingGroupOptions.values()) {
          const sortedOptions = options
            .map((group) => ({ group, movement: getMovementDistance(group) }))
            .sort((first, second) => first.movement - second.movement)
          selections = selections
            .flatMap((selection) =>
              sortedOptions.map((option) => ({
                groups: [...selection.groups, option.group],
                movement: selection.movement + option.movement,
              })),
            )
            .sort((first, second) => first.movement - second.movement)
            .slice(0, MAX_MULTI_CROSSING_SELECTIONS)
        }
        for (const selection of selections) {
          const candidate = this.tryCreateMultiCrossingCandidate({
            detourRouteIndex,
            detourSection,
            targetZ: detourCandidate.targetZ,
            crossingGroups: selection.groups,
            sectionsByRoute,
            baseClearanceIndexes,
          })
          if (candidate) return candidate
        }
        continue
      }

      const singleGroupOptions =
        crossingGroupOptions.values().next().value ?? []
      for (const crossingGroup of singleGroupOptions) {
        const transitionRouteIndex = crossingGroup.transitionRouteIndex
        const transitionSections = sectionsByRoute[transitionRouteIndex]
        const transitionSection =
          transitionSections[crossingGroup.transitionSectionIndex]
        baseClearanceIndexes ??= {
          mutableRoutes: new HighDensityRouteSpatialIndex(this.reducedHdRoutes),
          immutableRoutes: this.input.otherHdRoutes?.length
            ? new HighDensityRouteSpatialIndex([...this.input.otherHdRoutes])
            : null,
        }
        const candidate = this.tryCreateCandidate({
          detourRouteIndex,
          detourSection,
          targetZ: detourCandidate.targetZ,
          transitionRouteIndex,
          transitionSection,
          transitionSections,
          transitionSectionIndex: crossingGroup.transitionSectionIndex,
          side: crossingGroup.side,
          crossingDistances: crossingGroup.crossingDistances,
          baseClearanceIndexes,
        })
        if (candidate) return candidate
      }
    }
    return null
  }

  _step(): void {
    const candidate = this.findCrossingReduction()
    if (!candidate) {
      this.solved = true
      return
    }

    this.reducedHdRoutes[candidate.detourRouteIndex] = candidate.detourRoute
    for (const transitionUpdate of candidate.transitionUpdates) {
      this.reducedHdRoutes[transitionUpdate.routeIndex] = transitionUpdate.route
    }
    this.stats.crossingViaReductions =
      (this.stats.crossingViaReductions ?? 0) + 1
    this.stats.viasRemovedByCrossingReductions =
      (this.stats.viasRemovedByCrossingReductions ?? 0) + 2
  }

  getReducedHdRoutes(): HighDensityRoute[] {
    return this.reducedHdRoutes
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject &
      Pick<Required<GraphicsObject>, "lines" | "circles" | "rects"> = {
      lines: [],
      circles: [],
      rects: [],
      coordinateSystem: "cartesian",
      title: "Crossing Via Reduction Solver",
    }
    for (const obstacle of this.input.obstacles) {
      graphics.rects.push({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: "rgba(128, 128, 128, 0.2)",
      })
    }
    for (const route of this.reducedHdRoutes) {
      for (let index = 1; index < route.route.length; index++) {
        const start = route.route[index - 1]
        const end = route.route[index]
        if (start.z !== end.z) continue
        graphics.lines.push({
          points: [start, end],
          strokeColor: start.z === 0 ? "#d32f2f" : "#3367a8",
          strokeWidth: route.traceThickness,
          label: `${route.connectionName} (z=${start.z})`,
        })
      }
      for (const via of route.vias) {
        graphics.circles.push({
          center: via,
          radius: route.viaDiameter / 2,
          fill: "#ff20d6",
          label: `${route.connectionName} via`,
        })
      }
    }
    return graphics
  }
}
