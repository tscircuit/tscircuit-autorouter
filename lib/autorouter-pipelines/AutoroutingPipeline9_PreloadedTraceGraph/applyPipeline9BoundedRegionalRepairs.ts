import {
  extractRepairRegion,
  getFixedObstacleViolations,
  getNewViaPadViolations,
  mergeRepairRegion,
  negotiateTraceClearance,
  type Bounds,
} from "@tscircuit/repair04"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import { applyPipeline9ClearanceProjection } from "./applyPipeline9ClearanceProjection"

export type Pipeline9BoundedRegionalRepairResult = {
  routes: HighDensityRoute[]
  attemptedRegionCount: number
  acceptedRegionCount: number
  candidateAttemptCount: number
  pathSearchNodeCount: number
  referenceValidationCount: number
  initialDrcIssueCount: number | undefined
  finalDrcIssueCount: number | undefined
  repaired: boolean
}

type Pipeline9BoundedRegionalRepairParams = {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  syntheticConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
  viaHoleDiameter?: number
}

type RepairRegionLocation = {
  center: { x: number; y: number }
  size: number
}

const MAX_REGIONS = 4
const MAX_CANDIDATE_ATTEMPTS = 1024
const MAX_PATH_SEARCH_NODES = 480_000
const REGION_SIZES = [10, 16] as const

/** Keeps intermediate regional improvements private until full reference DRC passes. */
export const applyPipeline9BoundedRegionalRepairs = ({
  originalSrj,
  routes,
  syntheticConnectionNames,
  drcEvaluator,
  viaHoleDiameter,
}: Pipeline9BoundedRegionalRepairParams): Pipeline9BoundedRegionalRepairResult => {
  const result: Pipeline9BoundedRegionalRepairResult = {
    routes,
    attemptedRegionCount: 0,
    acceptedRegionCount: 0,
    candidateAttemptCount: 0,
    pathSearchNodeCount: 0,
    referenceValidationCount: 0,
    initialDrcIssueCount: undefined,
    finalDrcIssueCount: undefined,
    repaired: false,
  }
  if (originalSrj.traces?.length || syntheticConnectionNames.size > 0) {
    return result
  }
  const clearance = Math.max(
    originalSrj.defaultObstacleMargin ?? 0.2,
    originalSrj.minTraceToPadEdgeClearance ?? 0,
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
  const regionSizes = REGION_SIZES.filter(
    (size) => !Number.isFinite(boundaryMargin) || boundaryMargin * 2 < size,
  )
  if (regionSizes.length === 0) return result
  let currentRoutes = routes
  let reference = drcEvaluator({ traces: [], routes, hdRoutes: routes })
  result.referenceValidationCount++
  let currentErrors = Array.isArray(reference) ? reference : reference.errors
  result.initialDrcIssueCount = currentErrors.length
  result.finalDrcIssueCount = currentErrors.length
  if (currentErrors.length === 0) {
    return result
  }

  const projectedRoutes = applyPipeline9ClearanceProjection({
    originalSrj,
    routes: currentRoutes,
    drcEvaluator: (input): ReturnType<DrcEvaluator> => {
      result.referenceValidationCount++
      return drcEvaluator(input)
    },
  })
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
  let fixedViolations = new Map(
    getFixedObstacleViolations({ srj, routes: currentRoutes }).map(
      (violation) => [violation.key, violation.severity],
    ),
  )
  while (
    result.attemptedRegionCount < MAX_REGIONS &&
    result.candidateAttemptCount < MAX_CANDIDATE_ATTEMPTS &&
    result.pathSearchNodeCount < MAX_PATH_SEARCH_NODES
  ) {
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
      const center = centers.find(
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
      if (center) {
        nextRegion = { center, size }
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
    // Share the work limit across regions so congestion history survives
    // while a coupled group is rerouted. Early convergence leaves work for
    // the next region without increasing the total search budget.
    const repair = negotiateTraceClearance({
      srj: region.srj,
      routes: region.routes,
      bounds: region.mutableBounds,
      dirtyRouteIndices,
      isLocked: (routeIndex, pointIndex): boolean =>
        region.lockedPointIndices[routeIndex]![pointIndex]!,
      maxPathSearchCalls: MAX_CANDIDATE_ATTEMPTS - result.candidateAttemptCount,
      maxPathSearchNodes: MAX_PATH_SEARCH_NODES - result.pathSearchNodeCount,
      allowLayerChanges: true,
      traceClearance: RELAXED_DRC_OPTIONS.traceClearance!,
      viaClearance: RELAXED_DRC_OPTIONS.viaClearance!,
      viaHoleDiameter,
    })
    const { pathSearchCalls: candidateAttempts, pathSearchNodes } = repair
    if (
      !Number.isSafeInteger(candidateAttempts) ||
      candidateAttempts < 0 ||
      candidateAttempts + result.candidateAttemptCount > MAX_CANDIDATE_ATTEMPTS ||
      !Number.isSafeInteger(pathSearchNodes) ||
      pathSearchNodes < 0 ||
      pathSearchNodes + result.pathSearchNodeCount > MAX_PATH_SEARCH_NODES
    ) {
      throw new Error(
        "Pipeline9 bounded regional repair exceeded its work budget",
      )
    }
    result.candidateAttemptCount += candidateAttempts
    result.pathSearchNodeCount += pathSearchNodes
    const negotiatedRoutes = mergeRepairRegion({
      routes: currentRoutes,
      region,
      repairedRoutes: repair.routes,
    })
    if (negotiatedRoutes.every((route, index) => route === currentRoutes[index])) {
      continue
    }
    // Negotiation can leave small coupled gaps. Project the complete proposal
    // before atomically validating it against the incoming physical copper.
    const candidateRoutes = applyPipeline9ClearanceProjection({
      originalSrj,
      routes: negotiatedRoutes,
      drcEvaluator: (input): ReturnType<DrcEvaluator> => {
        result.referenceValidationCount++
        return drcEvaluator(input)
      },
    })
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
    const candidateReference = drcEvaluator({
      traces: [],
      routes: candidateRoutes,
      hdRoutes: candidateRoutes,
    })
    result.referenceValidationCount++
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
    result.finalDrcIssueCount = currentErrors.length
    if (currentErrors.length === 0) {
      result.routes = currentRoutes
      result.repaired = true
      return result
    }
  }
  return result
}
