import {
  Repair04Solver,
  extractRepairRegion,
  getFixedObstacleViolations,
  getNewViaPadViolations,
  mergeRepairRegion,
  type Bounds,
} from "@tscircuit/repair04"
import type { DrcEvaluator } from "high-density-repair03/lib"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"

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
}

type RepairRegionLocation = {
  center: { x: number; y: number }
  size: number
}

const MAX_REGIONS = 4
const MAX_CANDIDATE_ATTEMPTS_PER_REGION = 256
const MAX_PATH_SEARCH_NODES_PER_REGION = 120_000
const REGION_SIZES = [10, 16] as const

/** Keeps intermediate regional improvements private until full reference DRC passes. */
export const applyPipeline9BoundedRegionalRepairs = ({
  originalSrj,
  routes,
  syntheticConnectionNames,
  drcEvaluator,
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
  while (result.attemptedRegionCount < MAX_REGIONS) {
    const centeredErrors = Array.isArray(reference)
      ? reference
      : (reference.errorsWithCenters ?? reference.errors)
    const centers = centeredErrors
      .map((error) => {
        // Pad clearance reports can place their display marker at the trace's
        // midpoint, far from the offending copper. Crop around the pad itself.
        const padId =
          typeof error.pcb_pad_id === "string"
            ? error.pcb_pad_id
            : typeof error.pcb_trace_error_id === "string"
              ? error.pcb_trace_error_id.match(
                  /_(pcb_(?:smtpad|plated_hole|hole|keepout)_\d+)$/,
                )?.[1]
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
    // locked collar. Both sizes share the same four-region work budget.
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
    const solver = new Repair04Solver({
      srj: region.srj,
      routes: region.routes,
      bounds: region.bounds,
      boundaryMargin: region.boundaryMargin,
      lockedPointIndices: region.lockedPointIndices,
      maxCandidates: MAX_CANDIDATE_ATTEMPTS_PER_REGION,
      maxCandidateAttempts: MAX_CANDIDATE_ATTEMPTS_PER_REGION,
      maxPathSearchNodes: MAX_PATH_SEARCH_NODES_PER_REGION,
      allowLayerChanges: true,
      traceOnlyFirst: false,
    })
    solver.solve()
    if (solver.failed) {
      throw new Error(
        `Pipeline9 bounded regional repair failed: ${solver.error}`,
      )
    }
    const { candidateAttempts, pathSearchNodes } = solver.stats
    if (
      !Number.isSafeInteger(candidateAttempts) ||
      candidateAttempts < 0 ||
      candidateAttempts > MAX_CANDIDATE_ATTEMPTS_PER_REGION ||
      !Number.isSafeInteger(pathSearchNodes) ||
      pathSearchNodes < 0 ||
      pathSearchNodes > MAX_PATH_SEARCH_NODES_PER_REGION
    ) {
      throw new Error(
        "Pipeline9 bounded regional repair exceeded its work budget",
      )
    }
    result.candidateAttemptCount += candidateAttempts
    result.pathSearchNodeCount += pathSearchNodes
    const candidateRoutes = mergeRepairRegion({
      routes: currentRoutes,
      region,
      repairedRoutes: solver.getOutput(),
    })
    if (
      candidateRoutes.every((route, index) => route === currentRoutes[index])
    ) {
      continue
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
