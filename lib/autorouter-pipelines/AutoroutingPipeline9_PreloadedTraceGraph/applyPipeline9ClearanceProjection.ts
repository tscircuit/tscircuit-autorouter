import {
  getFixedObstacleViolations,
  getNewViaPadViolations,
  relaxTraceClearance,
  type Bounds,
} from "@tscircuit/repair04"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { canonicalizePipeline9HdRoutes } from "./canonicalizePipeline9HdRoutes"

/** Opens coupled copper gaps while keeping terminals, junctions and widths fixed. */
export const applyPipeline9ClearanceProjection = ({
  originalSrj,
  routes,
  drcEvaluator,
  mutableBounds,
}: {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  drcEvaluator: DrcEvaluator
  mutableBounds?: Bounds
}): HighDensityRoute[] => {
  const reference = drcEvaluator({ traces: [], routes, hdRoutes: routes })
  const errors = Array.isArray(reference) ? reference : reference.errors
  if (errors.length === 0) return routes
  const srj = {
    ...createSrjWithBoardValidObstacleLayers(originalSrj),
    traces: undefined,
  }
  const canonicalRoutes = canonicalizePipeline9HdRoutes(routes)
  // Preserve transition indices for the via guard. A regional proposal must
  // keep copper outside its mutable area fixed during projection as well.
  const candidate = relaxTraceClearance({
    srj,
    routes: canonicalRoutes,
    bounds: mutableBounds ?? srj.bounds,
    boundaryMargin: 0,
    boardEdgeClearance: originalSrj.minBoardEdgeClearance ?? 0,
    lockedPointIndices: canonicalRoutes.map((route) =>
      route.route.map((point) =>
        mutableBounds
          ? point.x < mutableBounds.minX ||
            point.x > mutableBounds.maxX ||
            point.y < mutableBounds.minY ||
            point.y > mutableBounds.maxY
          : false,
      ),
    ),
    allowViaMovement: true,
    traceClearance:
      originalSrj.minTraceToPadEdgeClearance ??
      RELAXED_DRC_OPTIONS.traceClearance,
    viaClearance: RELAXED_DRC_OPTIONS.viaClearance,
  })
  const fixedViolations = new Map(
    getFixedObstacleViolations({ srj, routes: canonicalRoutes }).map(
      (violation) => [violation.key, violation.severity],
    ),
  )
  if (
    getFixedObstacleViolations({ srj, routes: candidate }).some(
      ({ key, severity }) =>
        !fixedViolations.has(key) ||
        severity > fixedViolations.get(key)! + 1e-8,
    ) ||
    getNewViaPadViolations({
      srj,
      previousRoutes: canonicalRoutes,
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
