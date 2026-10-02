import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { PreloadedHighDensityRoute } from "./convertPreloadedTraceToHdRoutes"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9AxisAlignedWireApproximations,
  getPipeline9FixedRouteObstacles,
  getPipeline9RouteCopperGeometry,
  type Pipeline9AxisAlignedRect,
  type Pipeline9RouteViaSpan,
  type Pipeline9RouteWireSegment,
} from "./pipeline9FixedRouteCopper"
import {
  areAllPortPointsOnNodeBoundary,
  createRegionalFallbackProblem,
  spliceFixedRouteSection,
  type FixedRouteSection,
} from "./pipeline9RegionalFallback"
import { Pipeline9HighDensitySolver } from "./Pipeline9HighDensitySolver"
import { Pipeline9RegionalFallbackSolver } from "./Pipeline9RegionalFallbackSolver"
import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"

export type Pipeline9RegionalB01RepairResult = {
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

export type Pipeline9RegionalB01RepairParams = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  fixedObstacleRoutes: PreloadedHighDensityRoute[]
  newConnections: SimpleRouteConnection[]
  syntheticConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
  initialErrors?: Pipeline9DrcError[]
  allowTracePairRepair?: boolean
  preloadRepairTraceIds: ReadonlySet<string>
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
}

type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type FixedRouteCopperSpatialIndex = {
  getRoutesOverlappingBounds: (bounds: Bounds) => PreloadedHighDensityRoute[]
}

export type Pipeline9RegionalB01CandidateProblem = {
  solver: Pipeline9HighDensitySolver
  routes: HighDensityRoute[]
  movableRoute: PreloadedHighDensityRoute
  movableSection: FixedRouteSection
  routeIndex: number
}

export type Pipeline9RegularRegionalCandidateProblem = {
  solver: Pipeline9RegionalFallbackSolver
  routes: HighDensityRoute[]
  regionalRoutes: PreloadedHighDensityRoute[]
  problem: ReturnType<typeof createRegionalFallbackProblem>
  candidateBounds: Bounds
  localFixedObstacleRoutes: PreloadedHighDensityRoute[]
  obstacleMargin: number
  connMap: ConnectivityMap
  srj: SimpleRouteJson
}

export const PIPELINE9_REGIONAL_B01_REGION_SIZES = [3, 4, 5, 6, 8] as const
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

export const getRepairCenter = (error: Pipeline9DrcError, srj: SimpleRouteJson) => {
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

export const isMovableTracePairError = (
  error: Pipeline9DrcError,
  routeIndexByTraceId: ReadonlyMap<string, number>,
): boolean => {
  if (
    error.type !== "pcb_trace_error" ||
    typeof error.pcb_via_id === "string" ||
    (Array.isArray(error.pcb_via_ids) && error.pcb_via_ids.length > 0)
  ) {
    return false
  }
  return (
    getPipeline9RegionalRepairTraceIds({ error, routeIndexByTraceId })
      .length === 2
  )
}

export const getViaIssueCount = (errors: Pipeline9DrcError[]): number => {
  return errors.filter(
    (error) =>
      error.type === "pcb_via_clearance_error" ||
      Array.isArray(error.pcb_via_ids),
  ).length
}

export const asRegionalRoutes = (
  routes: HighDensityRoute[],
  connMap: ConnectivityMap,
): PreloadedHighDensityRoute[] => {
  const counts = new Map<string, number>()
  for (const route of routes) {
    counts.set(
      route.connectionName,
      (counts.get(route.connectionName) ?? 0) + 1,
    )
  }
  return routes.map((route, routeIndex) => {
    // Separate pieces of one connection still need distinct splice identities.
    const connectionName =
      counts.get(route.connectionName)! > 1
        ? `${route.connectionName}_regional_${routeIndex}`
        : route.connectionName
    if (connectionName !== route.connectionName) {
      connMap.addConnections([
        [
          connectionName,
          route.connectionName,
          route.rootConnectionName ?? route.connectionName,
        ],
      ])
    }
    return {
      ...route,
      connectionName,
      preloadedTraceId: `pipeline9_joint_candidate_${routeIndex}`,
      preloadedTraceIndex: routeIndex,
      preloadedRouteIndex: 0,
      isThroughObstacle: false,
    }
  })
}

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
  opts: Pick<SimpleRouteJson, "layerCount" | "allowBlindAndBuriedVias">,
): boolean => {
  const geometry = getPipeline9RouteCopperGeometry(route, opts)
  return (
    geometry.wireSegments.some((segment) =>
      boundsOverlap(wireSegmentBounds(segment), bounds),
    ) ||
    geometry.viaSpans.some((via) => boundsOverlap(viaSpanBounds(via), bounds))
  )
}

export const createFixedRouteCopperSpatialIndex = (
  routes: PreloadedHighDensityRoute[],
  srj: SimpleRouteJson,
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
    const geometry = getPipeline9RouteCopperGeometry(routes[routeIndex]!, srj)
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
        .filter((route) => routeCopperOverlapsBounds(route, bounds, srj))
    },
  }
}

const candidateConflictsWithFixedRoutes = ({
  candidateRoutes,
  fixedObstacleRoutes,
  obstacleMargin,
  connMap,
  candidateBounds,
  srj,
}: {
  candidateRoutes: HighDensityRoute[]
  fixedObstacleRoutes: PreloadedHighDensityRoute[]
  obstacleMargin: number
  connMap: ConnectivityMap
  candidateBounds?: Bounds
  srj: SimpleRouteJson
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
          layerCount: srj.layerCount,
          allowBlindAndBuriedVias: srj.allowBlindAndBuriedVias,
        })
      ) {
        return true
      }
    }
  }
  return false
}

export const preparePipeline9RegionalB01Candidate = ({
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
}): Pipeline9RegionalB01CandidateProblem | undefined => {
  const regionalRoutes = asRegionalRoutes(routes, connMap)
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
    fixedHdRoutes: [...fixedRoutes, ...fixedObstacleRoutes].map((route) => ({
      ...route,
      rootConnectionName:
        connMap.getNetConnectedToId(
          route.rootConnectionName ?? route.connectionName,
        ) ??
        route.rootConnectionName ??
        route.connectionName,
    })),
    connMap,
    colorMap,
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    allowBlindAndBuriedVias: srj.allowBlindAndBuriedVias,
    viaDiameter,
    traceWidth,
    obstacleMargin,
    effort,
    preserveTerminalPcbPortIds: true,
    includeBoardObstacles: true,
    enableRegionalFallback: false,
    maxB01Rips: 120,
  })
  return { solver, routes, movableRoute, movableSection, routeIndex }
}

export const getPipeline9RegionalB01CandidateOutput = ({
  solver,
  routes,
  movableRoute,
  movableSection,
  routeIndex,
}: Pipeline9RegionalB01CandidateProblem):
  | { routes: HighDensityRoute[]; usedFallback: boolean }
  | undefined => {
  if (!solver.solved || solver.failed) return undefined
  const replacement = solver.routes.find(
    (route) => route.connectionName === movableRoute.connectionName,
  )
  if (!replacement) return undefined

  return {
    routes: routes.map((route, candidateRouteIndex) =>
      candidateRouteIndex === routeIndex
        ? {
            ...spliceFixedRouteSection(movableSection, replacement),
            connectionName: route.connectionName,
          }
        : route,
    ),
    usedFallback: Number(solver.stats.fallbackNodeCount ?? 0) > 0,
  }
}

export const preparePipeline9RegularRegionalCandidate = ({
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
}): Pipeline9RegularRegionalCandidateProblem | undefined => {
  const regionalRoutes = asRegionalRoutes(routes, connMap)
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
      const geometry = getPipeline9RouteCopperGeometry(route, srj)
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
    allowBlindAndBuriedVias: srj.allowBlindAndBuriedVias,
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
    allowBlindAndBuriedVias: srj.allowBlindAndBuriedVias,
  })
  return {
    solver,
    routes,
    regionalRoutes,
    problem,
    candidateBounds,
    localFixedObstacleRoutes,
    obstacleMargin,
    connMap,
    srj,
  }
}

export const getPipeline9RegularRegionalCandidateOutput = ({
  solver,
  routes,
  regionalRoutes,
  problem,
  candidateBounds,
  localFixedObstacleRoutes,
  obstacleMargin,
  connMap,
  srj,
}: Pipeline9RegularRegionalCandidateProblem): HighDensityRoute[] | undefined => {
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
    return [
      {
        ...(replacedRouteByOriginalIndex.get(routeIndex) ?? route),
        connectionName: routes[routeIndex]!.connectionName,
      },
    ]
  })
  if (
    candidateConflictsWithFixedRoutes({
      candidateRoutes,
      fixedObstacleRoutes: localFixedObstacleRoutes,
      obstacleMargin,
      connMap,
      candidateBounds,
      srj,
    })
  ) {
    return undefined
  }
  return candidateRoutes
}
