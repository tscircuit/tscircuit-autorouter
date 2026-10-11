// Pinned high-density-repair02 at 64bc8a1d5a1af753f1043092ffa9ec820ed14d4e.
// Copyright (c) tscircuit Inc. MIT license retained in ./LICENSE.
// Native repair order, geometry arithmetic, candidate budgets and stats retained.
import { synchronizeRouteVias } from "high-density-repair02/lib/high-density-repair-solver/functions/synchronizeRouteVias"
import { repairNodeClearance } from "./repairNodeClearance"
import { FixedCopperClearanceGuard } from "high-density-repair02/lib/high-density-repair-solver/functions/FixedCopperClearanceGuard"
import { clampRoutePointsToBoundary } from "high-density-repair02/lib/high-density-repair-solver/functions/clampRoutePointsToBoundary"
import { cloneRoute } from "high-density-repair02/lib/high-density-repair-solver/functions/cloneRoute"
import { cloneRoutes } from "high-density-repair02/lib/high-density-repair-solver/functions/cloneRoutes"
import { createFinalFrame } from "high-density-repair02/lib/high-density-repair-solver/functions/createFinalFrame"
import { createInitialFrame } from "high-density-repair02/lib/high-density-repair-solver/functions/createInitialFrame"
import { dedupeRoutePoints } from "high-density-repair02/lib/high-density-repair-solver/functions/dedupeRoutePoints"
import {
  findClearanceConflicts,
  getClearanceConflictKey,
} from "high-density-repair02/lib/high-density-repair-solver/functions/findClearanceConflicts"
import { findInteriorDiagonalSegmentsInBufferZone } from "high-density-repair02/lib/high-density-repair-solver/functions/findInteriorDiagonalSegmentsInBufferZone"
import { findTraceClearanceRegressions } from "high-density-repair02/lib/high-density-repair-solver/functions/findTraceClearanceRegressions"
import { getBoundaryRect } from "high-density-repair02/lib/high-density-repair-solver/functions/getBoundaryRect"
import { normalizeBoundaryAnchoredRoutes } from "high-density-repair02/lib/high-density-repair-solver/functions/normalizeBoundaryAnchoredRoutes"
import {
  BOUNDARY_SIDES,
  EPSILON,
  MAX_REPAIR_PASSES,
  TRACE_CLEARANCE_REGRESSION_MAX,
} from "high-density-repair02/lib/high-density-repair-solver/shared/constants"
import type {
  BoundaryRect,
  BuildRepairFramesResult,
  DatasetSample,
  HdRoute,
  RouteGeometryCache,
  VisualizationFrame,
} from "high-density-repair02/lib/high-density-repair-solver/shared/types"
import { processBoundarySide } from "high-density-repair02/lib/high-density-repair-solver/steps/processBoundarySide"
import { targetedBoundaryCleanup } from "high-density-repair02/lib/high-density-repair-solver/steps/targetedBoundaryCleanup"

const introducesNewClearanceConflicts = (
  currentRoutes: HdRoute[],
  candidateRoutes: HdRoute[],
  routeIndex: number,
  minimumClearance: number,
): boolean => {
  const currentConflicts = new Set(
    findClearanceConflicts(
      currentRoutes,
      new Set([routeIndex]),
      minimumClearance,
    ).map(getClearanceConflictKey),
  )
  const candidateConflicts = findClearanceConflicts(
    candidateRoutes,
    new Set([routeIndex]),
    minimumClearance,
  )

  return candidateConflicts.some(
    (candidateConflict) =>
      !currentConflicts.has(getClearanceConflictKey(candidateConflict)),
  )
}

const nudgeInteriorPointsInsideBoundary = ({
  routes,
  boundary,
  clearanceMargin,
  fixedCopperGuard,
}: {
  routes: BuildRepairFramesResult["repairedRoutes"]
  boundary: NonNullable<BuildRepairFramesResult["boundary"]>
  clearanceMargin: number
  fixedCopperGuard: FixedCopperClearanceGuard
}): void => {
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex] as HdRoute
    const points = route.route ?? []
    if (points.length <= 2) continue

    const rawNudge = clearanceMargin
    const maxXInteriorNudge = Math.max(boundary.width / 2 - EPSILON, 0)
    const maxYInteriorNudge = Math.max(boundary.height / 2 - EPSILON, 0)
    const xNudge = Math.min(rawNudge, maxXInteriorNudge)
    const yNudge = Math.min(rawNudge, maxYInteriorNudge)
    // The pad is legal copper for this route, not a cell-clearance obstacle.
    const sides = route.connectedPadSides ?? []
    const minX = boundary.minX + (sides.includes("left") ? 0 : xNudge)
    const maxX = boundary.maxX - (sides.includes("right") ? 0 : xNudge)
    const minY = boundary.minY + (sides.includes("bottom") ? 0 : yNudge)
    const maxY = boundary.maxY - (sides.includes("top") ? 0 : yNudge)
    const candidateRoute = cloneRoute(route)
    const candidatePoints = candidateRoute.route ?? []
    let changed = false

    for (
      let pointIndex = 1;
      pointIndex < candidatePoints.length - 1;
      pointIndex += 1
    ) {
      const point = candidatePoints[pointIndex]
      if (!point) continue

      const nextX = Math.min(Math.max(point.x, minX), maxX)
      const nextY = Math.min(Math.max(point.y, minY), maxY)

      if (
        Math.abs(nextX - point.x) > EPSILON ||
        Math.abs(nextY - point.y) > EPSILON
      ) {
        point.x = nextX
        point.y = nextY
        changed = true
      }
    }

    if (!changed) continue

    candidateRoute.route = dedupeRoutePoints(candidatePoints)
    if ((candidateRoute.route?.length ?? 0) < 2) continue

    const candidateRoutes = cloneRoutes(routes)
    candidateRoutes[routeIndex] = candidateRoute

    const introducesNewTouches = introducesNewClearanceConflicts(
      routes,
      candidateRoutes,
      routeIndex,
      0,
    )
    const introducesNewDrcClearanceConflicts = introducesNewClearanceConflicts(
      routes,
      candidateRoutes,
      routeIndex,
      clearanceMargin,
    )
    const introducesTraceClearanceRegressions =
      findTraceClearanceRegressions({
        currentRoutes: routes,
        candidateRoutes,
        candidateRouteIndexes: new Set([routeIndex]),
        maximumAllowedClearance: clearanceMargin,
      }).length > 0

    if (
      introducesNewTouches ||
      introducesNewDrcClearanceConflicts ||
      introducesTraceClearanceRegressions ||
      !fixedCopperGuard.allows(routes, candidateRoutes, [routeIndex])
    ) {
      continue
    }

    routes[routeIndex] = candidateRoute
  }
}

const countBoundaryViolations = (
  routes: HdRoute[],
  boundary: BoundaryRect,
  margin: number,
): number => findInteriorDiagonalSegmentsInBufferZone(routes, boundary, margin).length

const getRouteNetNames = (route: HdRoute | undefined): string[] => {
  if (!route) return []
  const names = [route.connectionName, route.rootConnectionName].filter(
    (name): name is string => Boolean(name),
  )
  return Array.from(new Set(names))
}

const areRoutesSameNet = (
  firstRoute: HdRoute | undefined,
  secondRoute: HdRoute | undefined,
): boolean => {
  const firstNames = getRouteNetNames(firstRoute)
  const secondNames = getRouteNetNames(secondRoute)
  if (firstNames.length === 0 || secondNames.length === 0) return false
  return firstNames.some((name) => secondNames.includes(name))
}

const countTraceViolations = (
  routes: HdRoute[],
  geometryCache: RouteGeometryCache,
): number =>
  findClearanceConflicts(
    routes,
    new Set(routes.map((_, routeIndex) => routeIndex)),
    TRACE_CLEARANCE_REGRESSION_MAX,
    geometryCache,
  ).filter(
    (conflict) =>
      !(conflict.layers[0] === "via" && conflict.layers[1] === "via") &&
      !areRoutesSameNet(
        routes[conflict.routeIndexes[0]],
        routes[conflict.routeIndexes[1]],
      ),
  ).length

/**
 * Rotate side ordering per pass to avoid always processing the same side first,
 * which bakes in a bias in the single-pass repair.
 */
const getSidesForPass = (pass: number): Array<(typeof BOUNDARY_SIDES)[number]> => {
  const order = BOUNDARY_SIDES
  const rotated = [
    ...order.slice(pass % order.length),
    ...order.slice(0, pass % order.length),
  ]
  return rotated
}

export const buildRepairFrames = (
  sample: DatasetSample | undefined,
  requestedMargin: number | undefined,
  captureProgressFrames = false,
  repairBoundaryDiagonals = true,
): BuildRepairFramesResult => {
  const boundary = getBoundaryRect(sample?.nodeWithPortPoints)
  const inputRoutes = (sample?.nodeHdRoutes ?? []).map(synchronizeRouteVias)
  const margin = Math.max(requestedMargin ?? 0.4, 0.05)
  const fixedCopperGuard = new FixedCopperClearanceGuard(
    sample?.fixedHdRoutes ?? [],
    Math.min(margin / 2, TRACE_CLEARANCE_REGRESSION_MAX),
    sample?.clearanceObstacles ?? sample?.adjacentObstacles,
  )
  const normalizedRoutes =
    boundary && repairBoundaryDiagonals
      ? clampRoutePointsToBoundary(
          normalizeBoundaryAnchoredRoutes(cloneRoutes(inputRoutes), boundary),
          boundary,
        )
      : cloneRoutes(inputRoutes)
  const baseRoutes =
    repairBoundaryDiagonals &&
    fixedCopperGuard.allows(inputRoutes, normalizedRoutes, inputRoutes.keys())
      ? normalizedRoutes
      : inputRoutes
  const repairedRoutes = cloneRoutes(baseRoutes)

  if (!boundary) {
    return {
      boundary: null,
      baseRoutes,
      repairedRoutes,
      margin,
      frames: [
        {
          title: "HighDensityRepair02 Missing Boundary",
          routes: repairedRoutes,
        },
      ],
    }
  }

  const frames: VisualizationFrame[] = captureProgressFrames
    ? [createInitialFrame(cloneRoutes(repairedRoutes), margin)]
    : []
  if (repairBoundaryDiagonals) {
    const geometryCache: RouteGeometryCache = new WeakMap()

    let lastViolationCount = countBoundaryViolations(
      repairedRoutes,
      boundary,
      margin,
    )

    for (let pass = 0; pass < MAX_REPAIR_PASSES; pass += 1) {
      // Reset locked routes each pass: after a bridge move, a route is no
      // longer 2-point anyway, but on later passes we want the option to
      // re-shift it to eliminate remaining boundary violations.
      const lockedTwoPointRoutes = new Set<number>()
      let totalMovesAccepted = 0

      for (const side of getSidesForPass(pass)) {
        const { movesAccepted } = processBoundarySide({
          side,
          sample,
          boundary,
          frames,
          margin,
          repairedRoutes,
          captureProgressFrames,
          lockedTwoPointRoutes,
          geometryCache,
          fixedCopperGuard,
          // On retry passes, 2-point routes without an adjacent obstacle can
          // still be bridged inward when they cause boundary violations.
          allowTwoPointWithoutObstacle: pass >= 1,
        })
        totalMovesAccepted += movesAccepted
      }

      const currentViolationCount = countBoundaryViolations(
        repairedRoutes,
        boundary,
        margin,
      )

      // Stop early once we can't make progress anymore.
      if (totalMovesAccepted === 0) break
      if (currentViolationCount === 0) break
      if (currentViolationCount >= lastViolationCount) break
      lastViolationCount = currentViolationCount
    }

    // After the standard side-pass loop, run a targeted cleanup that nudges
    // points sitting FLUSH along a boundary side off the edge far enough
    // to stop being counted as a boundary violation. This handles the (very
    // common) case where the main repair pushes routes by `moveAmount` but
    // leaves points exactly on the boundary, because their endpoints were
    // clamped there. The cleanup itself iterates internally per route, so
    // we only need to call it once.
    const cleanupCandidateRoutes = cloneRoutes(repairedRoutes)
    const traceViolationsBeforeCleanup = countTraceViolations(
      repairedRoutes,
      geometryCache,
    )
    targetedBoundaryCleanup({
      routes: cleanupCandidateRoutes,
      boundary,
      margin,
      geometryCache,
      fixedCopperGuard,
    })
    const traceViolationsAfterCleanup = countTraceViolations(
      cleanupCandidateRoutes,
      geometryCache,
    )
    if (traceViolationsAfterCleanup <= traceViolationsBeforeCleanup) {
      repairedRoutes.splice(0, repairedRoutes.length, ...cleanupCandidateRoutes)
    }

    nudgeInteriorPointsInsideBoundary({
      routes: repairedRoutes,
      boundary,
      clearanceMargin: margin,
      fixedCopperGuard,
    })
  }

  const clearanceRepair = repairNodeClearance({
    fixedRoutes: sample?.fixedHdRoutes,
    routes: repairedRoutes,
    boundary,
    fixedCopperGuard,
    adjacentObstacles: sample?.adjacentObstacles,
    clearanceObstacles: sample?.clearanceObstacles,
    boundaryMargin: margin,
  })
  repairedRoutes.splice(0, repairedRoutes.length, ...clearanceRepair.routes)

  frames.push(
    createFinalFrame(
      cloneRoutes(repairedRoutes),
      cloneRoutes(baseRoutes),
      margin,
    ),
  )

  return {
    boundary,
    baseRoutes,
    repairedRoutes,
    frames,
    margin,
    clearanceRepairStats: {
      nodeClearanceInitialConflictCount: clearanceRepair.initialConflictCount,
      nodeClearanceFinalConflictCount: clearanceRepair.finalConflictCount,
      nodeClearanceCandidateCount: clearanceRepair.candidateCount,
    },
  }
}
