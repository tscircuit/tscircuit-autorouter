import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
} from "high-density-repair03/lib"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { PreloadedHighDensityRoute } from "./convert-preloaded-traces-to-hd-routes"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9AxisAlignedWireApproximations,
  getPipeline9FixedRouteObstacles,
  getPipeline9RouteCopperGeometry,
  type Pipeline9AxisAlignedRect,
  type Pipeline9RouteViaSpan,
  type Pipeline9RouteWireSegment,
} from "./pipeline9-fixed-route-copper"
import {
  areAllPortPointsOnNodeBoundary,
  createRegionalFallbackProblem,
  spliceFixedRouteSection,
} from "./pipeline9-regional-fallback"
import { Pipeline9HighDensitySolver } from "./pipeline9-high-density-solver"
import { Pipeline9RegionalFallbackSolver } from "./pipeline9-regional-fallback-solver"
import {
  getPipeline9DrcErrors,
  getPipeline9RouteIndexByTraceId,
  isPipeline9DrcErrorOwnedByPreloadRepair,
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "./pipeline9-joint-drc-repair-utils"

type RegionalB01RepairResult = {
  routes: HighDensityRoute[]
  attemptedCandidateCount: number
  acceptedCandidateCount: number
  fallbackCandidateCount: number
  candidateSearchCount: number
  candidateSearchBudget: number
  candidateSearchBudgetExhausted: boolean
  safeTraceLayerRepairSkippedForBudget: boolean
  remainingDrcIssueCount: number
  preloadEligibleDrcIssueCount: number
  preloadRepairAttempted: boolean
}

type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type FixedRouteCopperSpatialIndex = {
  getRoutesOverlappingBounds: (bounds: Bounds) => PreloadedHighDensityRoute[]
}

const REGION_SIZES = [3, 4, 5, 6, 8]
const FIXED_ROUTE_INDEX_CELL_SIZE = 4
const REGIONAL_REPAIR_SEARCH_VOLUME = 7_000
const MIN_REGIONAL_REPAIR_SEARCH_BUDGET = 16
const MAX_REGIONAL_REPAIR_SEARCH_BUDGET = 192

export { getPipeline9FixedRouteObstacles }

export const getPipeline9RegionalRepairSearchBudget = (
  routeCount: number,
): number => {
  if (!Number.isInteger(routeCount) || routeCount < 0) {
    throw new Error("Pipeline9 regional repair route count must be nonnegative")
  }
  const scaledBudget = Math.floor(
    REGIONAL_REPAIR_SEARCH_VOLUME / Math.max(1, routeCount),
  )
  return Math.max(
    MIN_REGIONAL_REPAIR_SEARCH_BUDGET,
    Math.min(MAX_REGIONAL_REPAIR_SEARCH_BUDGET, scaledBudget),
  )
}

const getErrorCenter = (error: Pipeline9DrcError) => {
  const center = error.center
  return center &&
    typeof center === "object" &&
    "x" in center &&
    "y" in center &&
    typeof center.x === "number" &&
    typeof center.y === "number"
    ? { x: center.x, y: center.y }
    : undefined
}

const getRepairCenter = (error: Pipeline9DrcError, srj: SimpleRouteJson) => {
  const obstacleId =
    typeof error.pcb_pad_id === "string"
      ? error.pcb_pad_id
      : typeof error.pcb_trace_error_id === "string"
        ? error.pcb_trace_error_id.match(
            /(pcb_(?:smtpad|plated_hole|hole|keepout)_\d+)$/,
          )?.[1]
        : undefined
  if (obstacleId) {
    const obstacle = srj.obstacles.find(
      (candidate) =>
        candidate.obstacleId === obstacleId ||
        candidate.connectedTo[0] === obstacleId,
    )
    if (obstacle) return obstacle.center
  }
  return getErrorCenter(error)
}

export const getPipeline9RegionalRepairTraceIds = ({
  error,
  routeIndexByTraceId,
}: {
  error: Pipeline9DrcError
  routeIndexByTraceId: ReadonlyMap<string, number>
}): string[] => {
  const primaryTraceId =
    typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined
  const viaIds = [
    ...(typeof error.pcb_via_id === "string" ? [error.pcb_via_id] : []),
    ...(Array.isArray(error.pcb_via_ids)
      ? error.pcb_via_ids.filter(
          (viaId): viaId is string => typeof viaId === "string",
        )
      : []),
  ]
  const pairPrefix = primaryTraceId ? `overlap_${primaryTraceId}_` : undefined
  const encodedOtherTraceId =
    pairPrefix &&
    typeof error.pcb_trace_error_id === "string" &&
    error.pcb_trace_error_id.startsWith(pairPrefix)
      ? error.pcb_trace_error_id.slice(pairPrefix.length)
      : undefined
  const encodedIdentityIsVia =
    encodedOtherTraceId !== undefined && viaIds.includes(encodedOtherTraceId)

  return [
    primaryTraceId,
    ...(Array.isArray(error.pcb_trace_ids) ? error.pcb_trace_ids : []),
    encodedIdentityIsVia ? undefined : encodedOtherTraceId,
  ]
    .filter(
      (traceId): traceId is string =>
        typeof traceId === "string" && routeIndexByTraceId.has(traceId),
    )
    .filter(
      (traceId, traceIndex, allTraceIds) =>
        allTraceIds.indexOf(traceId) === traceIndex,
    )
}

const asRegionalRoutes = (
  routes: HighDensityRoute[],
): PreloadedHighDensityRoute[] =>
  routes.map((route, routeIndex) => ({
    ...route,
    preloadedTraceId: `pipeline9_joint_candidate_${routeIndex}`,
    preloadedTraceIndex: routeIndex,
    preloadedRouteIndex: 0,
    isThroughObstacle: false,
  }))

const boundsOverlap = (left: Bounds, right: Bounds): boolean => {
  return (
    left.minX <= right.maxX &&
    left.maxX >= right.minX &&
    left.minY <= right.maxY &&
    left.maxY >= right.minY
  )
}

const wireSegmentBounds = (segment: Pipeline9RouteWireSegment): Bounds => ({
  minX: Math.min(segment.start.x, segment.end.x) - segment.width / 2,
  maxX: Math.max(segment.start.x, segment.end.x) + segment.width / 2,
  minY: Math.min(segment.start.y, segment.end.y) - segment.width / 2,
  maxY: Math.max(segment.start.y, segment.end.y) + segment.width / 2,
})

const viaSpanBounds = (via: Pipeline9RouteViaSpan): Bounds => ({
  minX: via.center.x - via.diameter / 2,
  maxX: via.center.x + via.diameter / 2,
  minY: via.center.y - via.diameter / 2,
  maxY: via.center.y + via.diameter / 2,
})

const rectBounds = (rect: Pipeline9AxisAlignedRect): Bounds => ({
  minX: rect.center.x - rect.width / 2,
  maxX: rect.center.x + rect.width / 2,
  minY: rect.center.y - rect.height / 2,
  maxY: rect.center.y + rect.height / 2,
})

const routeCopperOverlapsBounds = (
  route: HighDensityRoute,
  bounds: Bounds,
): boolean => {
  const geometry = getPipeline9RouteCopperGeometry(route)
  return (
    geometry.wireSegments.some((segment) =>
      boundsOverlap(wireSegmentBounds(segment), bounds),
    ) ||
    geometry.viaSpans.some((via) => boundsOverlap(viaSpanBounds(via), bounds))
  )
}

const createFixedRouteCopperSpatialIndex = (
  routes: PreloadedHighDensityRoute[],
): FixedRouteCopperSpatialIndex => {
  const routeIndexesByCell = new Map<string, Set<number>>()
  const addBounds = (routeIndex: number, bounds: Bounds): void => {
    const minCellX = Math.floor(bounds.minX / FIXED_ROUTE_INDEX_CELL_SIZE)
    const maxCellX = Math.floor(bounds.maxX / FIXED_ROUTE_INDEX_CELL_SIZE)
    const minCellY = Math.floor(bounds.minY / FIXED_ROUTE_INDEX_CELL_SIZE)
    const maxCellY = Math.floor(bounds.maxY / FIXED_ROUTE_INDEX_CELL_SIZE)
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
        const cellKey = `${cellX}:${cellY}`
        const routeIndexes = routeIndexesByCell.get(cellKey) ?? new Set()
        routeIndexes.add(routeIndex)
        routeIndexesByCell.set(cellKey, routeIndexes)
      }
    }
  }

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
    const geometry = getPipeline9RouteCopperGeometry(routes[routeIndex]!)
    for (const wireSegment of geometry.wireSegments) {
      for (const rect of getPipeline9AxisAlignedWireApproximations(
        wireSegment,
        FIXED_ROUTE_INDEX_CELL_SIZE,
        1,
      )) {
        addBounds(routeIndex, rectBounds(rect))
      }
    }
    for (const viaSpan of geometry.viaSpans) {
      addBounds(routeIndex, viaSpanBounds(viaSpan))
    }
  }

  return {
    getRoutesOverlappingBounds: (bounds) => {
      const routeIndexes = new Set<number>()
      const minCellX = Math.floor(bounds.minX / FIXED_ROUTE_INDEX_CELL_SIZE)
      const maxCellX = Math.floor(bounds.maxX / FIXED_ROUTE_INDEX_CELL_SIZE)
      const minCellY = Math.floor(bounds.minY / FIXED_ROUTE_INDEX_CELL_SIZE)
      const maxCellY = Math.floor(bounds.maxY / FIXED_ROUTE_INDEX_CELL_SIZE)
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
          for (const routeIndex of routeIndexesByCell.get(
            `${cellX}:${cellY}`,
          ) ?? []) {
            routeIndexes.add(routeIndex)
          }
        }
      }
      return [...routeIndexes]
        .sort((left, right) => left - right)
        .map((routeIndex) => routes[routeIndex]!)
        .filter((route) => routeCopperOverlapsBounds(route, bounds))
    },
  }
}

const candidateConflictsWithFixedRoutes = ({
  candidateRoutes,
  fixedObstacleRoutes,
  obstacleMargin,
  connMap,
  candidateBounds,
}: {
  candidateRoutes: HighDensityRoute[]
  fixedObstacleRoutes: PreloadedHighDensityRoute[]
  obstacleMargin: number
  connMap: ConnectivityMap
  candidateBounds?: Bounds
}): boolean => {
  for (const candidateRoute of candidateRoutes) {
    for (const fixedRoute of fixedObstacleRoutes) {
      if (arePipeline9RoutesOnSameNet(candidateRoute, fixedRoute, connMap)) {
        continue
      }
      if (
        doPipeline9RoutesHaveCopperConflict({
          left: candidateRoute,
          right: fixedRoute,
          clearance: obstacleMargin,
          leftBounds: candidateBounds,
        })
      ) {
        return true
      }
    }
  }
  return false
}

const getRegionalCandidate = ({
  routes,
  fixedObstacleRoutes,
  routeIndex,
  center,
  regionSize,
  srj,
  connMap,
  colorMap,
  viaDiameter,
  traceWidth,
  obstacleMargin,
  effort,
}: {
  routes: HighDensityRoute[]
  fixedObstacleRoutes: PreloadedHighDensityRoute[]
  routeIndex: number
  center: { x: number; y: number }
  regionSize: number
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
}):
  | {
      routes: HighDensityRoute[]
      usedFallback: boolean
    }
  | undefined => {
  const regionalRoutes = asRegionalRoutes(routes)
  const movableRoute = regionalRoutes[routeIndex]
  if (!movableRoute) return undefined
  const node = {
    capacityMeshNodeId: `pipeline9_joint_drc_${routeIndex}_${regionSize}`,
    center,
    width: regionSize,
    height: regionSize,
    availableZ: Array.from({ length: srj.layerCount }, (_, z) => z),
    portPoints: [],
    portPointsInPairs: [],
  }
  const movableProblem = createRegionalFallbackProblem(node, [movableRoute])
  const movableSection = movableProblem.fixedRouteSectionsByConnectionName.get(
    movableRoute.connectionName,
  )
  if (!movableSection) return undefined

  const fixedRoutes = regionalRoutes.filter(
    (_, candidateRouteIndex) => candidateRouteIndex !== routeIndex,
  )
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [movableProblem.nodeWithPortPoints],
    fixedHdRoutes: [...fixedRoutes, ...fixedObstacleRoutes],
    connMap,
    colorMap,
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    viaDiameter,
    traceWidth,
    obstacleMargin,
    effort,
    preserveTerminalPcbPortIds: true,
    includeBoardObstacles: true,
    enableRegionalFallback: false,
    maxB01Rips: 120,
  })
  solver.solve()
  if (!solver.solved || solver.failed) return undefined
  const replacement = solver.routes.find(
    (route) => route.connectionName === movableRoute.connectionName,
  )
  if (!replacement) return undefined

  return {
    routes: routes.map((route, candidateRouteIndex) =>
      candidateRouteIndex === routeIndex
        ? spliceFixedRouteSection(movableSection, replacement)
        : route,
    ),
    usedFallback: Number(solver.stats.fallbackNodeCount ?? 0) > 0,
  }
}

const getRegularRegionalCandidate = ({
  routes,
  fixedRouteCopperSpatialIndex,
  center,
  regionSize,
  srj,
  connMap,
  colorMap,
  viaDiameter,
  traceWidth,
  obstacleMargin,
  effort,
}: {
  routes: HighDensityRoute[]
  fixedRouteCopperSpatialIndex: FixedRouteCopperSpatialIndex
  center: { x: number; y: number }
  regionSize: number
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
}): HighDensityRoute[] | undefined => {
  const regionalRoutes = asRegionalRoutes(routes)
  const node = {
    capacityMeshNodeId: "pipeline9_joint_drc_regular_fallback",
    center,
    width: regionSize,
    height: regionSize,
    availableZ: Array.from({ length: srj.layerCount }, (_, z) => z),
    portPoints: [],
    portPointsInPairs: [],
  }
  const problem = createRegionalFallbackProblem(node, regionalRoutes)
  if (problem.fixedRouteSectionsByConnectionName.size === 0) return undefined
  // A-series solvers require perimeter terminals. A fixed route contained by
  // this DRC window creates interior splice anchors, so leave that candidate
  // to the later repair stages instead of passing an invalid node to A01/A03.
  if (!areAllPortPointsOnNodeBoundary(problem.nodeWithPortPoints)) {
    return undefined
  }
  const regionalSourceRoutes = [
    ...problem.fixedRouteSectionsByConnectionName.values(),
  ].flatMap((section) => section.sourceRoutes)
  const maxRegionalCopperRadius = regionalSourceRoutes.reduce(
    (maxRadius, route) => {
      const geometry = getPipeline9RouteCopperGeometry(route)
      return Math.max(
        maxRadius,
        route.viaDiameter / 2,
        ...geometry.wireSegments.map((segment) => segment.width / 2),
        ...geometry.viaSpans.map((via) => via.diameter / 2),
      )
    },
    Math.max(traceWidth / 2, viaDiameter / 2),
  )
  const candidateBounds: Bounds = {
    minX: center.x - regionSize / 2 - obstacleMargin - maxRegionalCopperRadius,
    maxX: center.x + regionSize / 2 + obstacleMargin + maxRegionalCopperRadius,
    minY: center.y - regionSize / 2 - obstacleMargin - maxRegionalCopperRadius,
    maxY: center.y + regionSize / 2 + obstacleMargin + maxRegionalCopperRadius,
  }
  const localFixedObstacleRoutes =
    fixedRouteCopperSpatialIndex.getRoutesOverlappingBounds(candidateBounds)
  const fixedRouteObstacles = getPipeline9FixedRouteObstacles({
    fixedObstacleRoutes: localFixedObstacleRoutes,
    layerCount: srj.layerCount,
  })
  const solver = new Pipeline9RegionalFallbackSolver({
    nodeWithPortPoints: problem.nodeWithPortPoints,
    colorMap,
    connMap,
    viaDiameter,
    traceWidth,
    obstacleMargin,
    effort,
    obstacles: [...srj.obstacles, ...fixedRouteObstacles],
    layerCount: srj.layerCount,
  })
  solver.solve()
  if (!solver.solved || solver.failed) return undefined
  const solverOutput = solver.getOutput()
  const replacementByConnectionName = new Map(
    solverOutput.map((route) => [route.connectionName, route]),
  )
  const replacedRouteByOriginalIndex = new Map<number, HighDensityRoute>()
  const removedOriginalIndexes = new Set<number>()
  for (const [
    connectionName,
    section,
  ] of problem.fixedRouteSectionsByConnectionName) {
    const replacement = replacementByConnectionName.get(connectionName)
    if (!replacement) return undefined
    replacedRouteByOriginalIndex.set(
      section.sourceRoutes[0]!.preloadedTraceIndex,
      spliceFixedRouteSection(section, replacement),
    )
    for (const sourceRoute of section.sourceRoutes.slice(1)) {
      removedOriginalIndexes.add(sourceRoute.preloadedTraceIndex)
    }
  }
  const candidateRoutes = regionalRoutes.flatMap((route, routeIndex) => {
    if (removedOriginalIndexes.has(routeIndex)) return []
    return [replacedRouteByOriginalIndex.get(routeIndex) ?? route]
  })
  if (
    candidateConflictsWithFixedRoutes({
      candidateRoutes,
      fixedObstacleRoutes: localFixedObstacleRoutes,
      obstacleMargin,
      connMap,
      candidateBounds,
    })
  ) {
    return undefined
  }
  return candidateRoutes
}

/**
 * Activates for a remaining preload-owned DRC error, then reroutes supported
 * joint-output participants with B01 in a sub-15mm window. B01 sees every
 * other route plus board copper as obstacles. Candidate searches use a
 * route-scaled budget because each search rebuilds and evaluates board copper.
 * If no B01 candidate helps, one regular high-density candidate jointly
 * reroutes all traces in the region.
 */
export const applyPipeline9RegionalB01Repairs = ({
  srj,
  routes,
  fixedObstacleRoutes,
  newConnections,
  syntheticConnectionNames,
  drcEvaluator,
  initialErrors,
  preloadRepairTraceIds,
  connMap,
  colorMap,
  viaDiameter,
  traceWidth,
  obstacleMargin,
  effort,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  fixedObstacleRoutes: PreloadedHighDensityRoute[]
  newConnections: SimpleRouteConnection[]
  syntheticConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
  initialErrors?: Pipeline9DrcError[]
  preloadRepairTraceIds: ReadonlySet<string>
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
}): RegionalB01RepairResult => {
  let currentRoutes = routes
  let currentErrors =
    initialErrors ?? getPipeline9DrcErrors(drcEvaluator, currentRoutes)
  let attemptedCandidateCount = 0
  let acceptedCandidateCount = 0
  let fallbackCandidateCount = 0
  let candidateSearchCount = 0
  let candidateSearchBudgetExhausted = false
  const candidateSearchBudget = getPipeline9RegionalRepairSearchBudget(
    routes.length,
  )
  const isPreloadRepairError = (error: Pipeline9DrcError): boolean => {
    return isPipeline9DrcErrorOwnedByPreloadRepair({
      error,
      preloadRepairTraceIds,
    })
  }
  const preloadEligibleDrcIssueCount =
    currentErrors.filter(isPreloadRepairError).length
  if (preloadEligibleDrcIssueCount === 0) {
    return {
      routes: currentRoutes,
      attemptedCandidateCount,
      acceptedCandidateCount,
      fallbackCandidateCount,
      candidateSearchCount,
      candidateSearchBudget,
      candidateSearchBudgetExhausted,
      safeTraceLayerRepairSkippedForBudget: false,
      remainingDrcIssueCount: currentErrors.length,
      preloadEligibleDrcIssueCount,
      preloadRepairAttempted: false,
    }
  }
  const fixedRouteCopperSpatialIndex =
    createFixedRouteCopperSpatialIndex(fixedObstacleRoutes)

  for (let pass = 0; pass < 2; pass++) {
    if (candidateSearchBudgetExhausted) break
    let acceptedOnPass = false
    const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
      routes: currentRoutes,
      newConnections,
      syntheticConnectionNames,
    })
    const repairableErrors = currentErrors.filter(
      (error) =>
        (error.type === "pcb_trace_error" ||
          error.type === "pcb_pad_trace_clearance_error" ||
          error.type === "pcb_via_trace_clearance_error" ||
          error.type === "pcb_via_clearance_error") &&
        typeof error.pcb_trace_id === "string",
    )
    for (const error of repairableErrors) {
      if (candidateSearchBudgetExhausted) break
      const center = getRepairCenter(error, srj)
      const traceIds = getPipeline9RegionalRepairTraceIds({
        error,
        routeIndexByTraceId,
      })
      if (!center) continue
      let bestRoutes = currentRoutes
      let bestErrors = currentErrors
      for (const traceId of traceIds.slice(0, 2)) {
        if (candidateSearchBudgetExhausted) break
        const routeIndex = routeIndexByTraceId.get(traceId)
        if (routeIndex === undefined) continue
        for (const regionSize of REGION_SIZES) {
          if (candidateSearchCount >= candidateSearchBudget) {
            candidateSearchBudgetExhausted = true
            break
          }
          candidateSearchCount++
          const candidate = getRegionalCandidate({
            routes: currentRoutes,
            fixedObstacleRoutes,
            routeIndex,
            center,
            regionSize,
            srj,
            connMap,
            colorMap,
            viaDiameter,
            traceWidth,
            obstacleMargin,
            effort,
          })
          if (!candidate) continue
          attemptedCandidateCount++
          if (candidate.usedFallback) fallbackCandidateCount++
          const candidateErrors = getPipeline9DrcErrors(
            drcEvaluator,
            candidate.routes,
          )
          if (isPipeline9DrcCandidateBetter(candidateErrors, bestErrors)) {
            bestRoutes = candidate.routes
            bestErrors = candidateErrors
          }
          if (bestErrors.length === 0) break
        }
        if (bestErrors.length === 0) break
      }
      if (bestRoutes === currentRoutes && !candidateSearchBudgetExhausted) {
        if (candidateSearchCount >= candidateSearchBudget) {
          candidateSearchBudgetExhausted = true
        } else {
          candidateSearchCount++
        }
      }
      if (bestRoutes === currentRoutes && !candidateSearchBudgetExhausted) {
        const fallbackRoutes = getRegularRegionalCandidate({
          routes: currentRoutes,
          fixedRouteCopperSpatialIndex,
          center,
          regionSize: 3,
          srj,
          connMap,
          colorMap,
          viaDiameter,
          traceWidth,
          obstacleMargin,
          effort,
        })
        if (fallbackRoutes) {
          attemptedCandidateCount++
          fallbackCandidateCount++
          const fallbackErrors = getPipeline9DrcErrors(
            drcEvaluator,
            fallbackRoutes,
          )
          if (isPipeline9DrcCandidateBetter(fallbackErrors, bestErrors)) {
            bestRoutes = fallbackRoutes
            bestErrors = fallbackErrors
          }
        }
      }
      if (bestRoutes !== currentRoutes) {
        currentRoutes = bestRoutes
        currentErrors = bestErrors
        acceptedCandidateCount++
        acceptedOnPass = true
      }
      if (candidateSearchBudgetExhausted) break
    }
    if (!acceptedOnPass || currentErrors.length === 0) break
  }

  const hasSafeLayerRepairableError = currentErrors.some(
    (error) =>
      error.type === "pcb_trace_error" ||
      error.type === "pcb_pad_trace_clearance_error",
  )
  const safeTraceLayerRepairSkippedForBudget =
    hasSafeLayerRepairableError && candidateSearchBudgetExhausted
  if (hasSafeLayerRepairableError && !candidateSearchBudgetExhausted) {
    const safeTraceLayerSolver = new GlobalDrcForceImproveSolver({
      srj: { ...srj, traces: undefined },
      hdRoutes: currentRoutes,
      connMap,
      effort,
      drcEvaluator,
      maxIterations: 8,
      enableLargeBoardBroadFallback: false,
      enableTargetedErrorSweep: false,
      enablePostSolveClearanceRelaxation: false,
      enableSafeTraceLayerMoves: true,
      enableViaInPadLayerMoves: false,
    })
    safeTraceLayerSolver.solve()
    if (safeTraceLayerSolver.failed) {
      throw new Error(
        `Pipeline9 post-regional safe trace-layer repair failed: ${safeTraceLayerSolver.error ?? "unknown error"}`,
      )
    }
    const safeLayerRoutes = safeTraceLayerSolver.getOutput()
    const safeLayerErrors = getPipeline9DrcErrors(drcEvaluator, safeLayerRoutes)
    if (isPipeline9DrcCandidateBetter(safeLayerErrors, currentErrors)) {
      currentRoutes = safeLayerRoutes
      currentErrors = safeLayerErrors
    }
  }

  return {
    routes: currentRoutes,
    attemptedCandidateCount,
    acceptedCandidateCount,
    fallbackCandidateCount,
    candidateSearchCount,
    candidateSearchBudget,
    candidateSearchBudgetExhausted,
    safeTraceLayerRepairSkippedForBudget,
    remainingDrcIssueCount: currentErrors.length,
    preloadEligibleDrcIssueCount,
    preloadRepairAttempted: preloadEligibleDrcIssueCount > 0,
  }
}
