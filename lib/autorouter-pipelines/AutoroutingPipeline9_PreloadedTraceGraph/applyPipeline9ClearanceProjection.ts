import {
  extractRepairRegion,
  getFixedObstacleViolations,
  getNewViaPadViolations,
  mergeRepairRegion,
  relaxTraceClearance,
} from "@tscircuit/repair04"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"

/** Opens coupled copper gaps while keeping terminals, junctions and widths fixed. */
export const applyPipeline9ClearanceProjection = ({
  originalSrj,
  routes,
  syntheticConnectionNames,
  drcEvaluator,
}: {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  syntheticConnectionNames: ReadonlySet<string>
  drcEvaluator: DrcEvaluator
}): HighDensityRoute[] => {
  if (originalSrj.traces?.length || syntheticConnectionNames.size > 0) {
    return routes
  }
  const reference = drcEvaluator({ traces: [], routes, hdRoutes: routes })
  const errors = Array.isArray(reference) ? reference : reference.errors
  if (errors.length === 0) return routes
  const srj = {
    ...createSrjWithBoardValidObstacleLayers(originalSrj),
    traces: undefined,
  }
  const centerX = (srj.bounds.minX + srj.bounds.maxX) / 2
  const centerY = (srj.bounds.minY + srj.bounds.maxY) / 2
  const width = Math.max(10, srj.bounds.maxX - srj.bounds.minX)
  const height = Math.max(10, srj.bounds.maxY - srj.bounds.minY)
  const region = extractRepairRegion({
    srj,
    routes,
    bounds: {
      minX: centerX - width / 2,
      maxX: centerX + width / 2,
      minY: centerY - height / 2,
      maxY: centerY + height / 2,
    },
  })
  const candidate = mergeRepairRegion({
    routes,
    region,
    repairedRoutes: relaxTraceClearance({
      ...region,
      allowViaMovement: true,
      traceClearance:
        originalSrj.minTraceToPadEdgeClearance ??
        RELAXED_DRC_OPTIONS.traceClearance,
      viaClearance: RELAXED_DRC_OPTIONS.viaClearance,
    }),
  })
  const fixedViolations = new Map(
    getFixedObstacleViolations({ srj, routes }).map((violation) => [
      violation.key,
      violation.severity,
    ]),
  )
  if (
    getFixedObstacleViolations({ srj, routes: candidate }).some(
      ({ key, severity }) =>
        !fixedViolations.has(key) ||
        severity > fixedViolations.get(key)! + 1e-8,
    ) ||
    getNewViaPadViolations({ srj, previousRoutes: routes, routes: candidate })
      .length > 0
  ) {
    return routes
  }
  const candidateReference = drcEvaluator({
    traces: [],
    routes: candidate,
    hdRoutes: candidate,
  })
  const candidateErrors = Array.isArray(candidateReference)
    ? candidateReference
    : candidateReference.errors
  return candidateErrors.length < errors.length ? candidate : routes
}
