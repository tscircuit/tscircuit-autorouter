import {
  getSegmentIntersection,
  pointToSegmentDistance,
  segmentToBoxMinDistance,
} from "@tscircuit/math-utils"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
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

const getCrossingDistances = (
  transitionSection: RouteSection,
  detourSection: RouteSection,
): number[] => {
  const crossingDistances: number[] = []
  let traversedDistance = 0
  for (
    let transitionIndex = 1;
    transitionIndex < transitionSection.points.length;
    transitionIndex++
  ) {
    const transitionStart = transitionSection.points[transitionIndex - 1]
    const transitionEnd = transitionSection.points[transitionIndex]
    const transitionSegmentLength = Math.hypot(
      transitionEnd.x - transitionStart.x,
      transitionEnd.y - transitionStart.y,
    )

    for (
      let detourIndex = 1;
      detourIndex < detourSection.points.length;
      detourIndex++
    ) {
      const detourStart = detourSection.points[detourIndex - 1]
      const detourEnd = detourSection.points[detourIndex]
      const intersection = getSegmentIntersection(
        transitionStart,
        transitionEnd,
        detourStart,
        detourEnd,
      )
      if (!intersection) continue

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
        continue
      }

      crossingDistances.push(traversedDistance + distanceFromTransitionStart)
    }
    traversedDistance += transitionSegmentLength
  }
  return crossingDistances
}

const sectionHasProtectedGeometry = (section: RouteSection): boolean => {
  return section.points.some(
    (point) => point.insideJumperPad || point.toNextSegmentType,
  )
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
  const section = sections[sectionIndex]
  const adjacentSection =
    side === "start" ? sections[sectionIndex - 1] : sections[sectionIndex + 1]
  if (!adjacentSection || adjacentSection.z !== targetZ) return false

  const sectionPoint =
    side === "start" ? section.points[0] : section.points.at(-1)!
  const adjacentPoint =
    side === "start"
      ? adjacentSection.points.at(-1)!
      : adjacentSection.points[0]
  return (
    sectionPoint.x === adjacentPoint.x && sectionPoint.y === adjacentPoint.y
  )
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
    otherRoutes: HighDensityRoute[],
  ): boolean {
    const hdRouteSHI = new HighDensityRouteSpatialIndex(otherRoutes)
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
    otherRoutes: HighDensityRoute[],
  ): boolean {
    const viaRadius = route.viaDiameter / 2
    const hdRouteSHI = new HighDensityRouteSpatialIndex(otherRoutes)
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

  private candidateIsClear(candidate: CrossingReductionCandidate): boolean {
    const unchangedRoutes = this.reducedHdRoutes.filter(
      (_, routeIndex) =>
        routeIndex !== candidate.detourRouteIndex &&
        routeIndex !== candidate.transitionRouteIndex,
    )
    const immutableRoutes = [...(this.input.otherHdRoutes ?? [])]
    const detourObstacles = [
      ...unchangedRoutes,
      ...immutableRoutes,
      candidate.transitionRoute,
    ]
    const transitionObstacles = [
      ...unchangedRoutes,
      ...immutableRoutes,
      candidate.detourRoute,
    ]
    return (
      this.routeIsClear(candidate.detourRoute, detourObstacles) &&
      this.routeIsClear(candidate.transitionRoute, transitionObstacles) &&
      this.relocatedViaIsClear(
        candidate.transitionRoute,
        candidate.relocatedVia,
        transitionObstacles,
      )
    )
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
  }: {
    detourRouteIndex: number
    detourSection: RouteSection
    targetZ: number
    transitionRouteIndex: number
    transitionSection: RouteSection
    transitionSections: RouteSection[]
    transitionSectionIndex: number
    side: TransitionSide
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
    const crossingDistances = getCrossingDistances(
      transitionSection,
      detourSection,
    )
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
    return this.candidateIsClear(candidate) ? candidate : null
  }

  private findCrossingReduction(): CrossingReductionCandidate | null {
    for (
      let detourRouteIndex = 0;
      detourRouteIndex < this.reducedHdRoutes.length;
      detourRouteIndex++
    ) {
      const detourRoute = this.reducedHdRoutes[detourRouteIndex]
      if (detourRoute.jumpers?.length) continue
      const detourSections = breakRouteIntoSections(detourRoute)
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

        for (
          let transitionRouteIndex = 0;
          transitionRouteIndex < this.reducedHdRoutes.length;
          transitionRouteIndex++
        ) {
          if (transitionRouteIndex === detourRouteIndex) continue
          const transitionRoute = this.reducedHdRoutes[transitionRouteIndex]
          if (
            transitionRoute.jumpers?.length ||
            routesAreSameNet(detourRoute, transitionRoute, this.input.connMap)
          ) {
            continue
          }

          const transitionSections = breakRouteIntoSections(transitionRoute)
          for (
            let transitionSectionIndex = 0;
            transitionSectionIndex < transitionSections.length;
            transitionSectionIndex++
          ) {
            const transitionSection = transitionSections[transitionSectionIndex]
            if (
              transitionSection.z !== previousSection.z ||
              sectionHasProtectedGeometry(transitionSection)
            ) {
              continue
            }

            for (const side of ["start", "end"] as const) {
              const candidate = this.tryCreateCandidate({
                detourRouteIndex,
                detourSection,
                targetZ: previousSection.z,
                transitionRouteIndex,
                transitionSection,
                transitionSections,
                transitionSectionIndex,
                side,
              })
              if (candidate) return candidate
            }
          }
        }
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
