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
  transitionRouteIndex: number
  detourRoute: HighDensityRoute
  transitionRoute: HighDensityRoute
  relocatedVia: { x: number; y: number }
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

const EPSILON = 1e-6
const DEFAULT_TRACE_MARGIN = 0.1
const DEFAULT_OBSTACLE_MARGIN = 0.15

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
  candidatePairRoute,
  ignoredConnectionNames,
}: {
  baseIndexes: BaseClearanceIndexes
  candidatePairRoute: HighDensityRoute
  ignoredConnectionNames: ReadonlySet<string>
}): RouteClearanceIndex => {
  const candidatePairIndex = new HighDensityRouteSpatialIndex([
    candidatePairRoute,
  ])
  return {
    getConflictingRoutesForSegment: (start, end, margin) => [
      ...baseIndexes.mutableRoutes
        .getConflictingRoutesForSegment(start, end, margin)
        .filter(
          ({ conflictingRoute }) =>
            !ignoredConnectionNames.has(conflictingRoute.connectionName),
        ),
      ...(baseIndexes.immutableRoutes?.getConflictingRoutesForSegment(
        start,
        end,
        margin,
      ) ?? []),
      ...candidatePairIndex.getConflictingRoutesForSegment(start, end, margin),
    ],
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
 * A-layer section whose existing via is adjacent to the crossing. The change
 * is atomic: the detour moves to A while the adjacent route's via moves past
 * the crossing and extends B through it. Every candidate is clearance-checked
 * as a route pair before either route is changed.
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

  private routeIsClear(
    route: HighDensityRoute,
    hdRouteSHI: RouteClearanceIndex,
  ): boolean {
    for (const section of breakRouteIntoSections(route)) {
      for (let index = 1; index < section.points.length; index++) {
        if (
          this.input.outline &&
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

  private candidateIsClear(
    candidate: CrossingReductionCandidate,
    baseIndexes: BaseClearanceIndexes,
  ): boolean {
    const ignoredConnectionNames = new Set([
      this.reducedHdRoutes[candidate.detourRouteIndex].connectionName,
      this.reducedHdRoutes[candidate.transitionRouteIndex].connectionName,
    ])
    const detourObstacleIndex = createCandidateClearanceIndex({
      baseIndexes,
      candidatePairRoute: candidate.transitionRoute,
      ignoredConnectionNames,
    })
    const transitionObstacleIndex = createCandidateClearanceIndex({
      baseIndexes,
      candidatePairRoute: candidate.detourRoute,
      ignoredConnectionNames,
    })
    this.stats.candidateClearanceChecks =
      (this.stats.candidateClearanceChecks ?? 0) + 1
    return (
      this.routeIsClear(candidate.detourRoute, detourObstacleIndex) &&
      this.routeIsClear(candidate.transitionRoute, transitionObstacleIndex) &&
      this.relocatedViaIsClear(
        candidate.transitionRoute,
        candidate.relocatedVia,
        transitionObstacleIndex,
      )
    )
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
      if (this.reducedHdRoutes[routeIndex].jumpers?.length) continue
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
      transitionRouteIndex,
      detourRoute: collapsedDetour,
      transitionRoute: relocatedTransition.route,
      relocatedVia: relocatedTransition.relocatedVia,
    }
    return this.candidateIsClear(candidate, baseClearanceIndexes)
      ? candidate
      : null
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
      if (this.reducedHdRoutes[detourRouteIndex].jumpers?.length) continue
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
      for (const crossingGroup of crossingGroups) {
        const transitionRouteIndex = crossingGroup.transitionRouteIndex
        const transitionRoute = this.reducedHdRoutes[transitionRouteIndex]
        if (
          transitionRoute.jumpers?.length ||
          routesAreSameNet(detourRoute, transitionRoute, this.input.connMap)
        ) {
          continue
        }

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
    this.reducedHdRoutes[candidate.transitionRouteIndex] =
      candidate.transitionRoute
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
