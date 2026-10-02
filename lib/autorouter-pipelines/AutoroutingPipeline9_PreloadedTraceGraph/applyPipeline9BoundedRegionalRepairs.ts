import {
  extractRepairRegion,
  getFixedObstacleViolations,
  getNewViaPadViolations,
  mergeRepairRegion,
  negotiateTraceClearanceSteps,
  type Bounds,
} from "@tscircuit/repair04"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import type { BaseSolver } from "lib/solvers/BaseSolver"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import { Pipeline9ClearanceProjectionSolver } from "./Pipeline9ClearanceProjectionSolver"
import { Pipeline9ReportedViaMergeSolver } from "./Pipeline9ReportedViaMergeSolver"
import { canonicalizePipeline9HdRoutes } from "./canonicalizePipeline9HdRoutes"
import { canPublishPartialFixedObstacleRepair } from "./canPublishPartialFixedObstacleRepair"

export type Pipeline9BoundedRegionalRepairResult = {
  routes: HighDensityRoute[]
  attemptedRegionCount: number
  acceptedRegionCount: number
  candidateAttemptCount: number
  pathSearchNodeCount: number
  referenceValidationCount: number
  initialDrcIssueCount: number | undefined
  finalDrcIssueCount: number | undefined
  publishedDrcIssueCount: number | undefined
  repaired: boolean
}

export const PIPELINE9_BOUNDED_REPAIR_BUDGET = {
  maxRegions: 4,
  maxCandidateAttempts: 1024,
  maxPathSearchNodes: 480_000,
} as const

export type Pipeline9BoundedRepairBudget = {
  maxRegions: number
  maxCandidateAttempts: number
  maxPathSearchNodes: number
  initialMaxRegions?: number
  initialMaxCandidateAttempts?: number
  initialMaxPathSearchNodes?: number
  regionsPerAcceptedRepair?: number
  candidateAttemptsPerAcceptedRepair?: number
  pathSearchNodesPerAcceptedRepair?: number
  maxPathSearchNodesPerCall?: number
  maxCandidateAttemptsPerRegion?: number
  pathGridSizeScale?: number
  pathHeuristicWeight?: number
  revisitChangedRegions?: boolean
  regionSizes?: readonly number[]
}

export const getPipeline9BoundedRepairBudget = (
  _routeCount: number,
  _drcIssueCount: number,
  effort: number,
): Pipeline9BoundedRepairBudget => {
  if (!Number.isFinite(effort) || effort <= 0) {
    throw new Error(
      "Pipeline9 regional repair effort must be positive and finite",
    )
  }
  // Every board starts with the same bounded allowance. Strict whole-board
  // DRC improvements earn more search work; board size never changes policy.
  // Effort scales both the initial allowance and the total ceiling smoothly.
  const scale = Math.max(1, effort)
  return {
    maxRegions: Math.ceil(24 * scale),
    maxCandidateAttempts: Math.ceil(4096 * scale),
    maxPathSearchNodes: Math.ceil(40_000_000 * scale),
    initialMaxRegions: Math.ceil(4 * scale),
    initialMaxCandidateAttempts: Math.ceil(1024 * scale),
    initialMaxPathSearchNodes: Math.ceil(2_000_000 * scale),
    regionsPerAcceptedRepair: 2,
    candidateAttemptsPerAcceptedRepair: 512,
    pathSearchNodesPerAcceptedRepair: 2_000_000,
    maxCandidateAttemptsPerRegion: 512,
    maxPathSearchNodesPerCall: 1_000_000,
    pathGridSizeScale: 2,
    pathHeuristicWeight: 3,
    revisitChangedRegions: true,
    regionSizes: [16, 32],
  }
}

export type Pipeline9BoundedRegionalRepairParams = {
  originalSrj: SimpleRouteJson
  connMap?: ConnectivityMap
  routes: HighDensityRoute[]
  syntheticConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
  viaHoleDiameter?: number
  budget?: Pipeline9BoundedRepairBudget
}

type RepairRegionLocation = {
  center: { x: number; y: number }
  size: number
}

const REGION_SIZES = [10, 16] as const

type RepairAllowance = {
  maxRegions: number
  maxCandidateAttempts: number
  maxPathSearchNodes: number
}

export const getPipeline9BoundedRepairAllowance = (
  budget: Pipeline9BoundedRepairBudget,
  acceptedRegionCount: number,
): RepairAllowance => ({
  maxRegions: Math.min(
    budget.maxRegions,
    (budget.initialMaxRegions ?? budget.maxRegions) +
      acceptedRegionCount * (budget.regionsPerAcceptedRepair ?? 0),
  ),
  maxCandidateAttempts: Math.min(
    budget.maxCandidateAttempts,
    (budget.initialMaxCandidateAttempts ?? budget.maxCandidateAttempts) +
      acceptedRegionCount * (budget.candidateAttemptsPerAcceptedRepair ?? 0),
  ),
  maxPathSearchNodes: Math.min(
    budget.maxPathSearchNodes,
    (budget.initialMaxPathSearchNodes ?? budget.maxPathSearchNodes) +
      acceptedRegionCount * (budget.pathSearchNodesPerAcceptedRepair ?? 0),
  ),
})

/** Searches regional repairs while yielding child solvers and bounded path batches. */
export function* pipeline9BoundedRegionalRepairSteps(
  {
    originalSrj,
    connMap,
    routes,
    syntheticConnectionNames,
    drcEvaluator,
    viaHoleDiameter,
    budget = PIPELINE9_BOUNDED_REPAIR_BUDGET,
  }: Pipeline9BoundedRegionalRepairParams,
  onProgress?: (result: Pipeline9BoundedRegionalRepairResult) => void,
): Generator<BaseSolver | void, Pipeline9BoundedRegionalRepairResult, void> {
  const result: Pipeline9BoundedRegionalRepairResult = {
    routes,
    attemptedRegionCount: 0,
    acceptedRegionCount: 0,
    candidateAttemptCount: 0,
    pathSearchNodeCount: 0,
    referenceValidationCount: 0,
    initialDrcIssueCount: undefined,
    finalDrcIssueCount: undefined,
    publishedDrcIssueCount: undefined,
    repaired: false,
  }
  onProgress?.(result)
  yield
  if (originalSrj.traces?.length || syntheticConnectionNames.size > 0) {
    return result
  }
  const clearance = Math.max(
    originalSrj.defaultObstacleMargin ?? 0.2,
    originalSrj.minTraceToPadEdgeClearance ?? 0,
    originalSrj.minTraceToHoleEdgeClearance ?? 0,
    originalSrj.minViaEdgeToPadEdgeClearance ?? 0,
  )
  let maxCopperDiameter = Math.max(
    originalSrj.minTraceWidth,
    originalSrj.minViaDiameter ?? 0,
  )
  for (const route of routes) {
    maxCopperDiameter = Math.max(
      maxCopperDiameter,
      route.traceThickness,
      route.viaDiameter,
    )
    for (const point of route.route) {
      maxCopperDiameter = Math.max(maxCopperDiameter, point.traceThickness ?? 0)
    }
  }
  // Repair04 requires a fixed collar of one copper diameter plus clearance.
  // Keep only bounded contexts that leave room for mutable copper.
  const boundaryMargin = Math.max(0.5, maxCopperDiameter + clearance)
  const regionSizes = (budget.regionSizes ?? REGION_SIZES).filter(
    (size) => !Number.isFinite(boundaryMargin) || boundaryMargin * 2 < size,
  )
  if (regionSizes.length === 0) return result
  let currentRoutes = routes
  let reference = drcEvaluator({ traces: [], routes, hdRoutes: routes })
  result.referenceValidationCount++
  let currentErrors = Array.isArray(reference) ? reference : reference.errors
  const initialErrors = currentErrors
  result.publishedDrcIssueCount = currentErrors.length
  result.initialDrcIssueCount = currentErrors.length
  result.finalDrcIssueCount = currentErrors.length
  onProgress?.(result)
  yield
  if (currentErrors.length === 0) {
    return result
  }

  const initialProjection = new Pipeline9ClearanceProjectionSolver({
    originalSrj,
    routes: currentRoutes,
    drcEvaluator: (input): ReturnType<DrcEvaluator> => {
      result.referenceValidationCount++
      return drcEvaluator(input)
    },
  })
  yield initialProjection
  const projectedRoutes = initialProjection.getOutput()
  if (projectedRoutes !== currentRoutes) {
    currentRoutes = projectedRoutes
    reference = drcEvaluator({
      traces: [],
      routes: currentRoutes,
      hdRoutes: currentRoutes,
    })
    result.referenceValidationCount++
    currentErrors = Array.isArray(reference) ? reference : reference.errors
    result.finalDrcIssueCount = currentErrors.length
    if (currentErrors.length === 0) {
      result.routes = currentRoutes
      result.publishedDrcIssueCount = 0
      result.repaired = true
      return result
    }
  }

  // Normalize only layer membership. Preserve original pad dimensions,
  // rotations, net aliases and board outline in the regional physical checks.
  const srj = {
    ...createSrjWithBoardValidObstacleLayers(originalSrj),
    traces: undefined,
  }
  const obstacleCenterById = new Map<string, { x: number; y: number }>()
  for (const obstacle of originalSrj.obstacles) {
    for (const id of [
      obstacle.obstacleId,
      obstacle.circuitJsonMetadata?.pcb_smtpad_id,
      obstacle.circuitJsonMetadata?.pcb_plated_hole_id,
      obstacle.connectedTo[0],
    ]) {
      if (typeof id === "string") obstacleCenterById.set(id, obstacle.center)
    }
  }
  const attemptedRegions: Array<{ bounds: Bounds; size: number }> = []
  currentRoutes = canonicalizePipeline9HdRoutes(currentRoutes)
  let fixedViolations = new Map(
    getFixedObstacleViolations({ srj, routes: currentRoutes }).map(
      (violation) => [violation.key, violation.severity],
    ),
  )
  while (true) {
    const allowance = getPipeline9BoundedRepairAllowance(
      budget,
      result.acceptedRegionCount,
    )
    if (
      result.attemptedRegionCount >= allowance.maxRegions ||
      result.candidateAttemptCount >= allowance.maxCandidateAttempts ||
      result.pathSearchNodeCount >= allowance.maxPathSearchNodes
    )
      break
    onProgress?.(result)
    yield
    const centeredErrors = Array.isArray(reference)
      ? reference
      : (reference.errorsWithCenters ?? reference.errors)
    const centers = centeredErrors
      .map((error) => {
        // Pad clearance reports can place their display marker at the trace's
        // midpoint, far from the offending copper. Crop around the pad itself.
        const pairPrefix = `overlap_${error.pcb_trace_id}_`
        const padId =
          typeof error.pcb_pad_id === "string"
            ? error.pcb_pad_id
            : typeof error.pcb_trace_error_id === "string" &&
                error.pcb_trace_error_id.startsWith(pairPrefix)
              ? error.pcb_trace_error_id.slice(pairPrefix.length)
              : undefined
        return (
          (padId ? obstacleCenterById.get(padId) : undefined) ??
          error.center ??
          error.pcb_center
        )
      })
      .filter(
        (point): point is { x: number; y: number } =>
          point !== null &&
          typeof point === "object" &&
          "x" in point &&
          "y" in point &&
          typeof point.x === "number" &&
          typeof point.y === "number" &&
          Number.isFinite(point.x) &&
          Number.isFinite(point.y),
      )
    let nextRegion: RepairRegionLocation | undefined
    // Wider context can move coupled errors away from a smaller region's
    // locked collar. Both sizes share the same call and search-node budgets.
    for (const size of regionSizes) {
      const pendingCenters = centers.filter(
        ({ x, y }) =>
          !attemptedRegions.some(
            ({ bounds, size: attemptedSize }) =>
              size === attemptedSize &&
              x >= bounds.minX &&
              x <= bounds.maxX &&
              y >= bounds.minY &&
              y <= bounds.maxY,
          ),
      )
      const seed = pendingCenters[0]
      if (seed) {
        // Center the mutable area around nearby errors as a group. Centering
        // on the first error can leave another repairable pad in the collar.
        let minX = seed.x
        let maxX = seed.x
        let minY = seed.y
        let maxY = seed.y
        const mutableSize = size - 2 * boundaryMargin
        for (const point of pendingCenters.slice(1)) {
          const nextMinX = Math.min(minX, point.x)
          const nextMaxX = Math.max(maxX, point.x)
          const nextMinY = Math.min(minY, point.y)
          const nextMaxY = Math.max(maxY, point.y)
          if (
            nextMaxX - nextMinX >= mutableSize ||
            nextMaxY - nextMinY >= mutableSize
          ) {
            continue
          }
          minX = nextMinX
          maxX = nextMaxX
          minY = nextMinY
          maxY = nextMaxY
        }
        nextRegion = {
          center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
          size,
        }
        break
      }
    }
    if (!nextRegion) break
    const { center, size } = nextRegion
    const region = extractRepairRegion({
      srj,
      routes: currentRoutes,
      bounds: {
        minX: center.x - size / 2,
        maxX: center.x + size / 2,
        minY: center.y - size / 2,
        maxY: center.y + size / 2,
      },
    })
    attemptedRegions.push({ bounds: region.mutableBounds, size })
    result.attemptedRegionCount++
    if (region.routes.length === 0) continue
    const dirtyTraceIds = new Set(currentErrors.flatMap(getDrcErrorTraceIds))
    const dirtyRouteIndices = region.routes.flatMap(
      (route, routeIndex): number[] =>
        [...dirtyTraceIds].some(
          (traceId): boolean =>
            traceId === route.connectionName ||
            traceId.startsWith(`${route.connectionName}_`),
        )
          ? [routeIndex]
          : [],
    )
    // Keep congestion history within each coupled group, but reserve calls
    // for another region instead of letting one stalled queue consume them
    // all. Every region still shares the same total call and node limits.
    const maxPathSearchCalls = Math.min(
      budget.maxCandidateAttemptsPerRegion ??
        (budget.revisitChangedRegions
          ? Math.ceil(allowance.maxCandidateAttempts / 2)
          : allowance.maxCandidateAttempts),
      allowance.maxCandidateAttempts - result.candidateAttemptCount,
    )
    const repair = yield* negotiateTraceClearanceSteps({
      srj: region.srj,
      routes: region.routes,
      bounds: region.mutableBounds,
      dirtyRouteIndices,
      isLocked: (routeIndex, pointIndex): boolean =>
        region.lockedPointIndices[routeIndex]![pointIndex]!,
      maxPathSearchCalls,
      maxPathSearchNodes:
        allowance.maxPathSearchNodes - result.pathSearchNodeCount,
      maxPathSearchNodesPerCall: budget.maxPathSearchNodesPerCall,
      pathHeuristicWeight: budget.pathHeuristicWeight,
      // Once congestion is localized, use the original fine grid to resolve
      // tight final gaps. Every proposal still passes full reference DRC.
      pathGridSizeScale:
        currentErrors.length > 10 ? budget.pathGridSizeScale : undefined,
      allowLayerChanges: true,
      traceClearance: RELAXED_DRC_OPTIONS.traceClearance!,
      viaClearance: RELAXED_DRC_OPTIONS.viaClearance!,
      viaHoleDiameter,
    })
    const { pathSearchCalls: candidateAttempts, pathSearchNodes } = repair
    // An exhausted queue with unresolved spans means the local context is
    // blocked. Expand it rather than spending later retries on the same collar.
    // Keep the small context while search is still consuming its work allowance.
    if (
      budget.revisitChangedRegions &&
      repair.unresolvedSpanCount > 0 &&
      candidateAttempts < maxPathSearchCalls &&
      pathSearchNodes <
        allowance.maxPathSearchNodes - result.pathSearchNodeCount
    ) {
      regionSizes.sort((a, b) => b - a)
    }
    if (
      !Number.isSafeInteger(candidateAttempts) ||
      candidateAttempts < 0 ||
      candidateAttempts + result.candidateAttemptCount >
        budget.maxCandidateAttempts ||
      !Number.isSafeInteger(pathSearchNodes) ||
      pathSearchNodes < 0 ||
      pathSearchNodes + result.pathSearchNodeCount > budget.maxPathSearchNodes
    ) {
      throw new Error(
        "Pipeline9 bounded regional repair exceeded its work budget",
      )
    }
    result.candidateAttemptCount += candidateAttempts
    result.pathSearchNodeCount += pathSearchNodes
    onProgress?.(result)
    yield
    const negotiatedRoutes = mergeRepairRegion({
      routes: currentRoutes,
      region,
      repairedRoutes: repair.routes,
    })
    if (
      negotiatedRoutes.every((route, index) => route === currentRoutes[index])
    ) {
      continue
    }
    // Negotiation can leave small coupled gaps. Project the complete proposal
    // before atomically validating it against the incoming physical copper.
    const candidateProjection = new Pipeline9ClearanceProjectionSolver({
      originalSrj,
      routes: negotiatedRoutes,
      previousRoutes: currentRoutes,
      subdivideSegments: true,
      usePrecisionMargin: true,
      drcEvaluator: (input): ReturnType<DrcEvaluator> => {
        result.referenceValidationCount++
        return drcEvaluator(input)
      },
    })
    yield candidateProjection
    let candidateRoutes = candidateProjection.getOutput()
    let candidateReference: ReturnType<DrcEvaluator> | undefined
    if (connMap) {
      const viaMerge = new Pipeline9ReportedViaMergeSolver({
        srj,
        routes: candidateRoutes,
        connMap,
        drcEvaluator,
      })
      yield viaMerge
      const mergeResult = viaMerge.getResult()
      result.referenceValidationCount += mergeResult.referenceValidationCount
      candidateReference = mergeResult.referenceResult
      candidateRoutes = mergeResult.routes
    }
    const candidateFixedViolations = getFixedObstacleViolations({
      srj,
      routes: candidateRoutes,
    })
    if (
      !candidateFixedViolations.every(
        ({ key, severity }) =>
          fixedViolations.has(key) &&
          severity <= fixedViolations.get(key)! + 1e-8,
      ) ||
      getNewViaPadViolations({
        srj,
        previousRoutes: currentRoutes,
        routes: candidateRoutes,
      }).length > 0
    ) {
      continue
    }
    if (candidateReference === undefined) {
      candidateReference = drcEvaluator({
        traces: [],
        routes: candidateRoutes,
        hdRoutes: candidateRoutes,
      })
      result.referenceValidationCount++
    }
    const candidateErrors = Array.isArray(candidateReference)
      ? candidateReference
      : candidateReference.errors
    if (candidateErrors.length >= currentErrors.length) continue
    currentRoutes = candidateRoutes
    currentErrors = candidateErrors
    reference = candidateReference
    fixedViolations = new Map(
      candidateFixedViolations.map((violation) => [
        violation.key,
        violation.severity,
      ]),
    )
    result.acceptedRegionCount++
    // Moving neighboring copper can open a path in an already visited region.
    // Revisit against the new geometry; strict DRC improvement and the shared
    // work limits bound these retries.
    if (budget.revisitChangedRegions) attemptedRegions.length = 0
    result.finalDrcIssueCount = currentErrors.length
    onProgress?.(result)
    yield
    if (currentErrors.length === 0) {
      result.routes = currentRoutes
      result.publishedDrcIssueCount = 0
      result.repaired = true
      return result
    }
  }
  if (
    canPublishPartialFixedObstacleRepair({
      originalSrj,
      initialErrors,
      remainingErrors: currentErrors,
    })
  ) {
    result.routes = currentRoutes
    result.publishedDrcIssueCount = currentErrors.length
    return result
  }
  // Independent wire repairs must not replace the coupled search's geometry:
  // fixing vias and adding slack can block otherwise feasible regional repairs.
  // When that search cannot publish, select safe nudges from the original input
  // so private regional changes cannot leak into the partial result.
  const independentProjection = new Pipeline9ClearanceProjectionSolver({
    originalSrj,
    routes,
    allowPartialRepair: true,
    drcEvaluator: (input): ReturnType<DrcEvaluator> => {
      result.referenceValidationCount++
      return drcEvaluator(input)
    },
  })
  yield independentProjection
  let independentRoutes = independentProjection.getOutput()
  // Refine the retained geometry separately: subdividing before the first
  // projection changes its forces and can discard already feasible nudges.
  const independentSubdivision = new Pipeline9ClearanceProjectionSolver({
    originalSrj,
    routes: independentRoutes,
    allowPartialRepair: true,
    subdivideSegments: true,
    drcEvaluator: (input): ReturnType<DrcEvaluator> => {
      result.referenceValidationCount++
      return drcEvaluator(input)
    },
  })
  yield independentSubdivision
  independentRoutes = independentSubdivision.getOutput()
  if (independentRoutes !== routes) {
    // The earlier whole-board pass already checked the original layout. Once
    // wire-only improvements have made room, try moving wires and vias together.
    // The complete-board DRC and physical guards decide whether to retain it.
    const coupledProjection = new Pipeline9ClearanceProjectionSolver({
      originalSrj,
      routes: independentRoutes,
      usePrecisionMargin: true,
      drcEvaluator: (input): ReturnType<DrcEvaluator> => {
        result.referenceValidationCount++
        return drcEvaluator(input)
      },
    })
    yield coupledProjection
    independentRoutes = coupledProjection.getOutput()
    const independentReference = drcEvaluator({
      traces: [],
      routes: independentRoutes,
      hdRoutes: independentRoutes,
    })
    result.referenceValidationCount++
    const independentErrors = Array.isArray(independentReference)
      ? independentReference
      : independentReference.errors
    result.routes = independentRoutes
    result.publishedDrcIssueCount = independentErrors.length
    result.finalDrcIssueCount = independentErrors.length
    result.repaired = independentErrors.length === 0
  }
  return result
}

/** Synchronous compatibility entrypoint; production callers step the solver. */
export const applyPipeline9BoundedRegionalRepairs = (
  params: Pipeline9BoundedRegionalRepairParams,
): Pipeline9BoundedRegionalRepairResult => {
  const steps = pipeline9BoundedRegionalRepairSteps(params)
  let next = steps.next()
  while (!next.done) {
    const child = next.value
    if (child) {
      while (!child.solved && !child.failed) child.step()
      if (child.failed) {
        throw new Error(
          `Pipeline9 regional repair child failed: ${child.error}`,
        )
      }
    }
    next = steps.next()
  }
  return next.value
}
