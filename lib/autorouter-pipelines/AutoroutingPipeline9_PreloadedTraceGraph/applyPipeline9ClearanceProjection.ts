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
import { canonicalizePipeline9HdRoutes } from "./canonicalizePipeline9HdRoutes"
import { selectIndependentClearanceRepairs } from "./selectIndependentClearanceRepairs"
import { canPublishIndependentClearanceRepairs } from "./canPublishIndependentClearanceRepairs"
import { CLEARANCE_PRECISION_MARGIN } from "./applyPipeline9ClearancePrecisionRepairs"
import { subdividePipeline9ClearanceSegments } from "./subdividePipeline9ClearanceSegments"

/** Opens coupled copper gaps while keeping terminals, junctions and widths fixed. */
export const applyPipeline9ClearanceProjection = ({
  originalSrj,
  routes,
  drcEvaluator,
  previousRoutes,
  allowPartialRepair = false,
  subdivideSegments = false,
  usePrecisionMargin = false,
}: {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  drcEvaluator: DrcEvaluator
  /** Geometry before regional rerouting, matching the outer via guard. */
  previousRoutes?: HighDensityRoute[]
  /** Retain independently safe wire adjustments on boards with mixed errors. */
  allowPartialRepair?: boolean
  /** Add local bend vertices after the original wire adjustments are retained. */
  subdivideSegments?: boolean
  /** Keep the same small clearance margin when validating a final coupled pass. */
  usePrecisionMargin?: boolean
}): HighDensityRoute[] => {
  const reference = drcEvaluator({ traces: [], routes, hdRoutes: routes })
  const errors = Array.isArray(reference) ? reference : reference.errors
  if (errors.length === 0) return routes
  const srj = {
    ...createSrjWithBoardValidObstacleLayers(originalSrj),
    traces: undefined,
  }
  const originalCanonicalRoutes = canonicalizePipeline9HdRoutes(routes)
  const canonicalRoutes =
    allowPartialRepair && subdivideSegments
      ? subdividePipeline9ClearanceSegments(originalCanonicalRoutes, errors)
      : originalCanonicalRoutes
  // Whole-board projection needs no cropping or splicing. Preserve every
  // transition's point indices so the via guard can prove its identity.
  let candidate = relaxTraceClearance({
    srj,
    routes: canonicalRoutes,
    bounds: srj.bounds,
    boundaryMargin: 0,
    boardEdgeClearance: originalSrj.minBoardEdgeClearance ?? 0,
    lockedPointIndices: canonicalRoutes.map((route) =>
      route.route.map(() => false),
    ),
    // Partial publication keeps drill sites fixed, so unresolved via errors
    // retain both their physical geometry and their reference-check identities.
    allowViaMovement: !allowPartialRepair,
    traceClearance:
      (originalSrj.minTraceToPadEdgeClearance ??
        RELAXED_DRC_OPTIONS.traceClearance!) +
      (allowPartialRepair || usePrecisionMargin ? CLEARANCE_PRECISION_MARGIN : 0),
    viaClearance: RELAXED_DRC_OPTIONS.viaClearance,
  })
  if (allowPartialRepair) {
    candidate = selectIndependentClearanceRepairs({
      srj,
      routes: canonicalRoutes,
      proposedRoutes: candidate,
    })
    // Do not retain extra vertices on protected or rejected routes.
    candidate = candidate.map(
      (route, index): HighDensityRoute =>
        route === canonicalRoutes[index]
          ? originalCanonicalRoutes[index]!
          : route,
    )
  }
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
      previousRoutes: previousRoutes ?? canonicalRoutes,
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
  const canPublish = allowPartialRepair
    ? canPublishIndependentClearanceRepairs(errors, candidateErrors)
    : candidateErrors.length < errors.length
  return canPublish ? candidate : routes
}
