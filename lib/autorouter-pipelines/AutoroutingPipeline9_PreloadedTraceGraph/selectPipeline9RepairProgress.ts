import {
  getFixedObstacleViolations,
  getNewViaPadViolations,
} from "@tscircuit/repair04"
import type { DrcEvaluator } from "high-density-repair03/lib"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type FixedObstacleViolationKey = ReturnType<
  typeof getFixedObstacleViolations
>[number]["key"]

const PHYSICAL_CLEARANCE_TOLERANCE_MM = 1e-8

/** Retains DRC improvements while guarding fixed obstacles and via-pad contacts. */
export const selectPipeline9RepairProgress = ({
  originalSrj,
  originalRoutes,
  candidates,
  drcEvaluator,
}: {
  originalSrj: SimpleRouteJson
  originalRoutes: HighDensityRoute[]
  candidates: HighDensityRoute[][]
  drcEvaluator: DrcEvaluator
}): { routes: HighDensityRoute[]; drcIssueCount: number } => {
  const srj = { ...originalSrj, traces: undefined }
  const fixedViolations = new Map<FixedObstacleViolationKey, number>(
    getFixedObstacleViolations({ srj, routes: originalRoutes }).map(
      ({ key, severity }) => [key, severity],
    ),
  )
  let routes = originalRoutes
  const initialReference = drcEvaluator({ traces: [], routes, hdRoutes: routes })
  let drcIssueCount: number
  if (Array.isArray(initialReference)) {
    drcIssueCount = initialReference.length
  } else {
    drcIssueCount = initialReference.errors.length
  }
  for (const candidate of candidates) {
    if (candidate === routes) continue
    const reference = drcEvaluator({
      traces: [],
      routes: candidate,
      hdRoutes: candidate,
    })
    let candidateDrcIssueCount: number
    if (Array.isArray(reference)) {
      candidateDrcIssueCount = reference.length
    } else {
      candidateDrcIssueCount = reference.errors.length
    }
    if (candidateDrcIssueCount >= drcIssueCount) continue
    if (
      getFixedObstacleViolations({ srj, routes: candidate }).some(
        ({ key, severity }) =>
          !fixedViolations.has(key) ||
          severity >
            fixedViolations.get(key)! + PHYSICAL_CLEARANCE_TOLERANCE_MM,
      ) ||
      getNewViaPadViolations({
        srj,
        previousRoutes: originalRoutes,
        routes: candidate,
      }).length > 0
    ) {
      continue
    }
    routes = candidate
    drcIssueCount = candidateDrcIssueCount
  }
  return { routes, drcIssueCount }
}
