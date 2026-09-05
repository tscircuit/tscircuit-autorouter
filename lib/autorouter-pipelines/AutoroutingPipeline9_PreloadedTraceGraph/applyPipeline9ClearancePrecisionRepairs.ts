import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  DrcEvaluator,
  SimpleRouteJson as RepairSimpleRouteJson,
} from "high-density-repair03/lib"
import {
  applyDrcErrorForces,
  cloneRoutes,
  materializeRoutes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  getPipeline9DrcErrorTraceIds,
  getPipeline9RouteIndexByTraceId,
  type Pipeline9DrcError,
} from "./pipeline9JointDrcRepairUtils"

type ClearancePrecisionRepairResult = {
  routes: HighDensityRoute[]
  attemptedCandidateCount: number
  repaired: boolean
}

type PreparedClearanceErrors = {
  errors: Pipeline9DrcError[]
  deficit: number
}

type Point = { x: number; y: number }

const MAX_CLEARANCE_ERROR_COUNT = 8
const MAX_PASSES = 8
const FORCE_SCALES = [0.03, 0.1, 0.25]

const prepareClearanceErrors = ({
  errors,
  errorsWithCenters,
  routeIndexByTraceId,
  padPositionById,
}: {
  errors: Pipeline9DrcError[]
  errorsWithCenters: Pipeline9DrcError[]
  routeIndexByTraceId: ReadonlyMap<string, number>
  padPositionById: ReadonlyMap<string, Point>
}): PreparedClearanceErrors | undefined => {
  if (errors.length === 0 || errors.length > MAX_CLEARANCE_ERROR_COUNT) {
    return undefined
  }
  const preparedErrors: Pipeline9DrcError[] = []
  let deficit = 0
  for (const error of errors) {
    const isViaTrace = error.type === "pcb_via_trace_clearance_error"
    const isPadTrace = error.type === "pcb_pad_trace_clearance_error"
    if (
      (!isViaTrace && !isPadTrace) ||
      typeof error.pcb_trace_id !== "string" ||
      !routeIndexByTraceId.has(error.pcb_trace_id) ||
      typeof error.actual_clearance !== "number" ||
      !Number.isFinite(error.actual_clearance) ||
      typeof error.minimum_clearance !== "number" ||
      !Number.isFinite(error.minimum_clearance)
    ) {
      return undefined
    }
    const traceIds = getPipeline9DrcErrorTraceIds(error)
    if (
      (isViaTrace && traceIds.length < 2) ||
      traceIds.some((traceId) => !routeIndexByTraceId.has(traceId))
    ) {
      return undefined
    }
    const centeredError = errorsWithCenters.find(
      (candidate) =>
        candidate.type === error.type &&
        candidate.pcb_trace_id === error.pcb_trace_id &&
        candidate.pcb_pad_id === error.pcb_pad_id &&
        candidate.pcb_via_id === error.pcb_via_id,
    )
    const center = isPadTrace
      ? typeof error.pcb_pad_id === "string"
        ? padPositionById.get(error.pcb_pad_id)
        : undefined
      : (centeredError?.center ?? error.center)
    if (!center || typeof center !== "object") return undefined
    const point = center as Record<string, unknown>
    if (
      typeof point.x !== "number" ||
      !Number.isFinite(point.x) ||
      typeof point.y !== "number" ||
      !Number.isFinite(point.y)
    ) {
      return undefined
    }
    preparedErrors.push({ ...error, center: { x: point.x, y: point.y } })
    deficit += Math.max(0, error.minimum_clearance - error.actual_clearance)
    if (!Number.isFinite(deficit)) return undefined
  }
  return { errors: preparedErrors, deficit }
}

/** Searches coupled clearance adjustments, publishing only reference-clean routes. */
export const applyPipeline9ClearancePrecisionRepairs = ({
  srj,
  routes,
  newConnections,
  syntheticConnectionNames,
  connMap,
  drcEvaluator,
  initialErrors,
  initialErrorsWithCenters = initialErrors,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  newConnections: SimpleRouteConnection[]
  syntheticConnectionNames: ReadonlySet<string>
  connMap: ConnectivityMap
  drcEvaluator: DrcEvaluator
  initialErrors: Pipeline9DrcError[]
  initialErrorsWithCenters?: Pipeline9DrcError[]
}): ClearancePrecisionRepairResult => {
  const unchanged = { routes, attemptedCandidateCount: 0, repaired: false }
  if ((srj.traces?.length ?? 0) > 0 || syntheticConnectionNames.size > 0) {
    return unchanged
  }
  const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
    routes,
    newConnections,
    syntheticConnectionNames,
  })
  const padPositionById = new Map<string, Point>()
  for (const obstacle of srj.obstacles) {
    for (const id of [
      obstacle.obstacleId,
      obstacle.circuitJsonMetadata?.pcb_smtpad_id,
      obstacle.circuitJsonMetadata?.pcb_plated_hole_id,
      obstacle.connectedTo[0],
    ]) {
      if (typeof id === "string") padPositionById.set(id, obstacle.center)
    }
  }
  const initial = prepareClearanceErrors({
    errors: initialErrors,
    errorsWithCenters: initialErrorsWithCenters,
    routeIndexByTraceId,
    padPositionById,
  })
  if (!initial) return unchanged
  let current: PreparedClearanceErrors = initial
  let currentRoutes = routes
  let attemptedCandidateCount = 0
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let bestRoutes = currentRoutes
    let best: PreparedClearanceErrors = current
    for (const scale of FORCE_SCALES) {
      const candidateRoutes = cloneRoutes(currentRoutes)
      const changed = applyDrcErrorForces(
        srj as RepairSimpleRouteJson,
        candidateRoutes,
        current.errors,
        routeIndexByTraceId,
        scale,
        connMap,
        true,
        true,
        true,
        false,
      )
      if (!changed) continue
      const materializedRoutes = materializeRoutes(candidateRoutes)
      attemptedCandidateCount++
      const result = drcEvaluator({
        traces: [],
        routes: materializedRoutes,
        hdRoutes: materializedRoutes,
      })
      const errors = Array.isArray(result) ? result : result.errors
      if (errors.length === 0) {
        return {
          routes: materializedRoutes,
          attemptedCandidateCount,
          repaired: true,
        }
      }
      const prepared = prepareClearanceErrors({
        errors,
        errorsWithCenters: Array.isArray(result)
          ? result
          : (result.errorsWithCenters ?? result.errors),
        routeIndexByTraceId,
        padPositionById,
      })
      // A coupled move can temporarily split one deficit between two objects.
      // Such intermediate routes stay private until every reference error clears.
      if (prepared && prepared.deficit < best.deficit - 1e-9) {
        bestRoutes = materializedRoutes
        best = prepared
      }
    }
    if (bestRoutes === currentRoutes) break
    currentRoutes = bestRoutes
    current = best
  }
  return { routes, attemptedCandidateCount, repaired: false }
}
