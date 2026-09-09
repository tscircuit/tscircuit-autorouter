import {
  getFixedObstacleViolations,
  getNewViaPadViolations,
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
  drcEvaluator,
}: {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  drcEvaluator: DrcEvaluator
}): HighDensityRoute[] => {
  const reference = drcEvaluator({ traces: [], routes, hdRoutes: routes })
  const errors = Array.isArray(reference) ? reference : reference.errors
  if (errors.length === 0) return routes
  const srj = {
    ...createSrjWithBoardValidObstacleLayers(originalSrj),
    traces: undefined,
  }
  // Whole-board projection needs no cropping or splicing. Preserve every
  // transition's point indices so the via guard can prove its identity.
  const candidate = relaxTraceClearance({
    srj,
    routes,
    bounds: srj.bounds,
    boundaryMargin: 0,
    boardEdgeClearance: originalSrj.minBoardEdgeClearance ?? 0,
    lockedPointIndices: routes.map((route) => route.route.map(() => false)),
    allowViaMovement: true,
    traceClearance:
      originalSrj.minTraceToPadEdgeClearance ??
      RELAXED_DRC_OPTIONS.traceClearance,
    viaClearance: RELAXED_DRC_OPTIONS.viaClearance,
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
    getNewViaPadViolations({
      srj,
      previousRoutes: routes,
      routes: candidate,
    }).length > 0
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
