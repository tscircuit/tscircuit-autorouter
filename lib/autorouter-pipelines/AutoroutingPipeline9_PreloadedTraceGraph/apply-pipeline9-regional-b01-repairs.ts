import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
} from "high-density-repair03/lib"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { PreloadedHighDensityRoute } from "./convert-preloaded-traces-to-hd-routes"
import {
  createRegionalFallbackProblem,
  spliceFixedRouteSection,
} from "./pipeline9-regional-fallback"
import { Pipeline9HighDensitySolver } from "./pipeline9-high-density-solver"
import { Pipeline9RegionalFallbackSolver } from "./pipeline9-regional-fallback-solver"
import {
  getPipeline9DrcErrors,
  getPipeline9RouteIndexByTraceId,
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "./pipeline9-joint-drc-repair-utils"

type RegionalB01RepairResult = {
  routes: HighDensityRoute[]
  attemptedCandidateCount: number
  acceptedCandidateCount: number
  fallbackCandidateCount: number
}

const REGION_SIZES = [3, 4, 5, 6]

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

const asRegionalRoutes = (
  routes: HighDensityRoute[],
): PreloadedHighDensityRoute[] =>
  routes.map((route, routeIndex) => ({
    ...route,
    preloadedTraceId: `pipeline9_joint_candidate_${routeIndex}`,
    preloadedTraceIndex: routeIndex,
    preloadedRouteIndex: 0,
  }))

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
  const solver = new Pipeline9RegionalFallbackSolver({
    nodeWithPortPoints: problem.nodeWithPortPoints,
    colorMap,
    connMap,
    viaDiameter,
    traceWidth,
    obstacleMargin,
    effort,
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
  })
  solver.solve()
  if (!solver.solved || solver.failed) return undefined
  const replacementByConnectionName = new Map(
    solver.getOutput().map((route) => [route.connectionName, route]),
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
  return regionalRoutes.flatMap((route, routeIndex) => {
    if (removedOriginalIndexes.has(routeIndex)) return []
    return [replacedRouteByOriginalIndex.get(routeIndex) ?? route]
  })
}

/**
 * Reroutes one exact DRC participant with B01 in a sub-15mm window. B01 sees
 * every other route plus board copper as obstacles. If no B01 candidate helps,
 * one regular high-density candidate jointly reroutes all traces in the region.
 */
export const applyPipeline9RegionalB01Repairs = ({
  srj,
  routes,
  fixedObstacleRoutes,
  newConnections,
  syntheticConnectionNames,
  drcEvaluator,
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
  connMap: ConnectivityMap
  colorMap: Record<string, string>
  viaDiameter: number
  traceWidth: number
  obstacleMargin: number
  effort: number
}): RegionalB01RepairResult => {
  let currentRoutes = routes
  let currentErrors = getPipeline9DrcErrors(drcEvaluator, currentRoutes)
  let attemptedCandidateCount = 0
  let acceptedCandidateCount = 0
  let fallbackCandidateCount = 0

  for (let pass = 0; pass < 2; pass++) {
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
          error.type === "pcb_via_trace_clearance_error") &&
        typeof error.pcb_trace_id === "string",
    )
    for (const error of repairableErrors) {
      const center = getRepairCenter(error, srj)
      const traceIds = [
        error.pcb_trace_id,
        ...(Array.isArray(error.pcb_trace_ids) ? error.pcb_trace_ids : []),
      ]
        .filter(
          (traceId): traceId is string =>
            typeof traceId === "string" && routeIndexByTraceId.has(traceId),
        )
        .filter(
          (traceId, traceIndex, allTraceIds) =>
            allTraceIds.indexOf(traceId) === traceIndex,
        )
      if (!center) continue
      let bestRoutes = currentRoutes
      let bestErrors = currentErrors
      for (const traceId of traceIds.slice(0, 2)) {
        const routeIndex = routeIndexByTraceId.get(traceId)
        if (routeIndex === undefined) continue
        for (const regionSize of REGION_SIZES) {
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
      if (bestRoutes === currentRoutes) {
        const fallbackRoutes = getRegularRegionalCandidate({
          routes: currentRoutes,
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
    }
    if (!acceptedOnPass || currentErrors.length === 0) break
  }

  const hasSafeLayerRepairableError = currentErrors.some(
    (error) =>
      error.type === "pcb_trace_error" ||
      error.type === "pcb_pad_trace_clearance_error",
  )
  if (hasSafeLayerRepairableError) {
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
  }
}
